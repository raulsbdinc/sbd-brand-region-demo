// POST /api/signin/passcode/verify  { code }
// ===========================================
// Second half of passcode sign-in. Reads the httpOnly handoff cookie written by
// .../start (which flow, the address, any auth_session), exchanges the code the
// matching way, applies the passwordless sub guard, and — on success — mints
// the SAME __session cookie shape as app/api/signin/password/route.ts so the
// session is identical across every entry point.
//
// Every failure — wrong code, unknown address, unlinked address, missing
// handoff, misconfig — returns the one generic message with no distinction.

import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import { resolvePasswordlessCreds, verifyEmailPasscode } from "@/lib/auth0-passwordless"
import {
  purgeTransientEmailStub,
  resolveBrandPasscodeAccount,
} from "@/lib/credential-resolver"
import { mintPrimarySessionCookie } from "@/lib/google-link-core"
import { resolveRegionAuthConfig, regionFromCookieHeader } from "@/lib/auth0-regions"
import {
  verifyDatabaseOtp,
  verifyPasswordlessOtp,
  passwordlessSubIsRealAccount,
  type TokenSet,
} from "@/lib/auth0-passcode-signin"
import { HANDOFF_COOKIE_NAME, decodeHandoff } from "@/lib/passcode-handoff"
import { applySessionCookie, SESSION_TTL_SECONDS } from "@/lib/session-cookie"

export const runtime = "nodejs"

// The drawer's existing generic passcode failure copy — reused verbatim.
const GENERIC_ERROR = "That code isn't right, or it's expired."

/** Same generic failure for every rejection path. Also clears the handoff. */
function fail(): NextResponse {
  const res = NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  res.cookies.set(HANDOFF_COOKIE_NAME, "", { path: "/", maxAge: 0 })
  return res
}

export async function POST(request: NextRequest) {
  let code = ""
  try {
    const body = await request.json()
    code = typeof body?.code === "string" ? body.code.trim() : ""
  } catch {
    return fail()
  }
  if (!code) return fail()

  const handoff = decodeHandoff(request.cookies.get(HANDOFF_COOKIE_NAME)?.value)
  if (!handoff) return fail()

  const cookieHeader = request.headers.get("cookie")
  const creds = resolvePasswordlessCreds(cookieHeader)
  if (!creds) return fail()

  // EU brand passcode: the code proves mailbox ownership only. Consume it at
  // the IdP (single-use), drop the transient email|… stub it may mint, then
  // re-resolve — NOW, server-side — the single account enrolled in THIS brand
  // for the address, and open THAT canonical. The code's own sub is never used.
  if (handoff.flow === "brand-proof") {
    try {
      await verifyEmailPasscode(creds, handoff.email, code)
    } catch {
      return fail()
    }
    await purgeTransientEmailStub(handoff.email)
    const canonical = await resolveBrandPasscodeAccount(handoff.email).catch(() => null)
    if (!canonical) return fail()
    const cookieValue = await mintPrimarySessionCookie(canonical, cookieHeader)
    if (!cookieValue) return fail()
    const response = NextResponse.json({ ok: true })
    applySessionCookie(
      response.cookies,
      cookieValue,
      request.cookies.getAll().map((c) => c.name),
      { maxAge: SESSION_TTL_SECONDS },
    )
    response.cookies.set(HANDOFF_COOKIE_NAME, "", { path: "/", maxAge: 0 })
    return response
  }

  // Exchange the code the way the resolved flow requires.
  let claims: Record<string, unknown>
  let tokens: TokenSet
  try {
    if (handoff.flow === "database") {
      if (!handoff.authSession) return fail()
      ;({ claims, tokens } = await verifyDatabaseOtp(
        creds,
        handoff.authSession,
        code,
      ))
    } else {
      ;({ claims, tokens } = await verifyPasswordlessOtp(
        creds,
        handoff.email,
        code,
      ))
      // THE GUARD: a bare email|… sub means Auth0 minted a brand-new empty
      // passwordless user — that is not an account on this storefront. Only a
      // primary (auth0|…) sub, returned because a linked alternate resolved to
      // it, is a real sign-in.
      if (!passwordlessSubIsRealAccount(claims.sub)) return fail()
    }
  } catch {
    return fail()
  }

  if (!tokens.access_token || !tokens.id_token) return fail()

  // Mint the session EXACTLY as the password route does (same helper, same
  // secret, same shape), so every entry point produces an identical session.
  const region = regionFromCookieHeader(cookieHeader)
  const { secret } = resolveRegionAuthConfig(region)
  if (!secret) return fail()

  const now = Math.floor(Date.now() / 1000)
  // SessionData.user requires a string `sub`; the decoded claims type it only as
  // unknown. It is guaranteed present here (the passwordless guard already
  // rejected a missing/`email|…` sub), so pin it explicitly for the type.
  const sub = typeof claims.sub === "string" ? claims.sub : ""
  const session = {
    user: { ...claims, sub },
    tokenSet: {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      scope: tokens.scope,
      expiresAt: now + (tokens.expires_in ?? SESSION_TTL_SECONDS),
    },
    internal: {
      sid:
        typeof claims.sid === "string"
          ? (claims.sid as string)
          : crypto.randomUUID(),
      createdAt: now,
    },
  }

  const cookieValue = await generateSessionCookie(session, { secret })
  const response = NextResponse.json({ ok: true })
  // Chunk-safe session write (see lib/session-cookie): a large shared-account
  // session must never be dropped by the browser's single-cookie size limit.
  applySessionCookie(
    response.cookies,
    cookieValue,
    request.cookies.getAll().map((c) => c.name),
    { maxAge: SESSION_TTL_SECONDS },
  )
  // Handoff has served its purpose.
  response.cookies.set(HANDOFF_COOKIE_NAME, "", { path: "/", maxAge: 0 })
  return response
}
