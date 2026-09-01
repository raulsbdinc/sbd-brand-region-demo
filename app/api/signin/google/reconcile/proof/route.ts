import { NextResponse, type NextRequest } from "next/server"
import { getUser, isManagementConfigured } from "@/lib/auth0-management"
import { resolveRegionAuthConfig, regionFromCookieHeader } from "@/lib/auth0-regions"
import {
  resolveSigninCredential,
  resolveSharedLoginAlias,
} from "@/lib/credential-resolver"
import { signinResolutionPermitsRealmOperation } from "@/lib/credential-model"
import { passwordRealmExchange } from "@/lib/auth0-password-grant"
import {
  resolvePasswordlessCreds,
  verifyEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"
import {
  journeyCookieName,
  journeyCookieOptions,
  readJourneyToken,
} from "@/lib/journey-handoff"
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  linkStandaloneGoogle,
  mintPrimarySessionCookie,
} from "@/lib/google-link-core"
import type { GoogleReconcileHandoff } from "../route"

// POST /api/signin/google/reconcile/proof
// =======================================
// The security gate of the cold-Google reconcile journey. The visitor proves
// they own the EXISTING account — by its password OR a one-time email code —
// and only THEN do we link the standalone Google identity onto that primary and
// restore the primary session. We NEVER link on an email match alone.
//
// The account being linked onto (primaryUserId), the Google record to link
// (googleSub), and the email to verify all come from the SIGNED handoff cookie,
// never the request body, so a caller cannot retarget the link or the proof.
// The NEW proof secret (password/OTP) is submitted here and never persisted or
// echoed. Failure collapses to a single generic message (no enumeration).
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const GOOGLE_LINK_PURPOSE = "google-link" as const
const GENERIC = "We couldn't verify that. Please try again."

function clearHandoff(res: NextResponse) {
  res.cookies.set(journeyCookieName(GOOGLE_LINK_PURPOSE), "", {
    ...journeyCookieOptions(),
    maxAge: 0,
  })
}

/** Mask an email for display: `jane.doe@x.com` → `j•••e@x.com`. */
function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at <= 0) return "your email"
  const name = email.slice(0, at)
  const domain = email.slice(at)
  if (name.length <= 2) return `${name[0] ?? "•"}•••${domain}`
  return `${name[0]}•••${name[name.length - 1]}${domain}`
}

// GET — non-secret summary for the /link-google page. Reads ONLY the signed
// handoff cookie (HttpOnly, so the page itself can't); never reveals the raw
// email or which account matched. Both proof methods are always offered: the
// existing account has a connection password, and a one-time code can go to its
// verified email.
export async function GET(request: NextRequest) {
  const handoff = readJourneyToken<GoogleReconcileHandoff>(
    GOOGLE_LINK_PURPOSE,
    request.cookies.get(journeyCookieName(GOOGLE_LINK_PURPOSE))?.value,
  )
  if (!handoff.ok) {
    return NextResponse.json({ pending: false }, { status: 200 })
  }
  return NextResponse.json({
    pending: true,
    maskedEmail: maskEmail(handoff.data.email),
    methods: ["password", "code"] as const,
  })
}

export async function POST(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie")

  const handoff = readJourneyToken<GoogleReconcileHandoff>(
    GOOGLE_LINK_PURPOSE,
    request.cookies.get(journeyCookieName(GOOGLE_LINK_PURPOSE))?.value,
  )
  // Missing / tampered / expired handoff → the journey must restart. Fail closed.
  if (!handoff.ok) {
    const res = NextResponse.json({ error: GENERIC }, { status: 400 })
    clearHandoff(res)
    return res
  }
  const { primaryUserId, googleSub, email } = handoff.data

  if (!isManagementConfigured()) {
    return NextResponse.json({ error: GENERIC }, { status: 400 })
  }

  let method: string
  let password = ""
  let code = ""
  try {
    const body = await request.json()
    method = typeof body?.method === "string" ? body.method : ""
    password = typeof body?.password === "string" ? body.password : ""
    code = typeof body?.code === "string" ? body.code.trim() : ""
  } catch {
    return NextResponse.json({ error: GENERIC }, { status: 400 })
  }

  const region = regionFromCookieHeader(cookieHeader)

  // STEP 1 — PROVE OWNERSHIP of the existing account.
  let proven = false
  if (method === "password") {
    const { domain, clientId, clientSecret } = resolveRegionAuthConfig(region)
    if (!domain || !clientId || !clientSecret || !password) {
      return NextResponse.json({ error: GENERIC }, { status: 401 })
    }
    // Resolve the existing account's connection exactly like sign-in, and fail
    // closed on an ambiguous/unavailable resolution (never guess a realm).
    const resolution = await resolveSigninCredential(email)
    if (!signinResolutionPermitsRealmOperation(resolution.kind)) {
      return NextResponse.json({ error: GENERIC }, { status: 401 })
    }
    const firstHop = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")[0]
      .trim()
    const connectionKey =
      resolution.kind === "resolved" ? resolution.connectionKey : "shared"
    // ATTEMPT 1 — the handoff email exactly as-is against the resolved realm.
    let token = await passwordRealmExchange({
      domain,
      clientId,
      clientSecret,
      firstHop,
      username: email,
      password,
      connectionKey,
    })

    // ATTEMPT 2 — SHARED login-alias fallback (Model 2). The Google address in
    // the handoff is a VERIFIED alternate email — a linked passwordless `email`
    // identity that carries NO password of its own; the ONE shared password
    // lives on the account's ROOT sbd-eu email. So a failed shared attempt with
    // the alias must be retried against the canonical primary login email,
    // exactly as the in-app sign-in route does. resolveSharedLoginAlias reuses
    // the same fail-closed alias primitive: it resolves ONLY when the address is
    // a verified alias/root of exactly one account that genuinely holds a shared
    // identity, creates no second password/identity, and returns "none"/
    // "ambiguous"/"unavailable"/"same-as-typed" (no retry) otherwise. Only the
    // shared path is eligible — a resolved case-3/4 realm is authoritative and
    // must never fall back to shared. This narrows ownership proof, never widens
    // it: the tenant still verifies the real shared password against the real
    // primary username.
    if (!token && connectionKey === "shared") {
      const alias = await resolveSharedLoginAlias(email)
      if (alias.kind === "resolved") {
        token = await passwordRealmExchange({
          domain,
          clientId,
          clientSecret,
          firstHop,
          username: alias.primaryEmail,
          password,
          connectionKey: "shared",
        })
      }
    }
    proven = Boolean(token)
  } else if (method === "code") {
    const creds = resolvePasswordlessCreds(region)
    if (!creds || !code) {
      return NextResponse.json({ error: GENERIC }, { status: 401 })
    }
    try {
      await verifyEmailPasscode(creds, email, code)
      proven = true
    } catch (err) {
      if (err instanceof PasswordlessError) proven = false
      else throw err
    }
  } else {
    return NextResponse.json({ error: GENERIC }, { status: 400 })
  }

  if (!proven) {
    // Wrong password / code. Keep the handoff so they can retry inline.
    return NextResponse.json({ error: GENERIC }, { status: 401 })
  }

  // STEP 2 — Ownership proven: link the standalone Google record onto the
  // primary using the shared core (identical rules to the signed-in flow), then
  // restore the primary session so the visitor lands as their real account.
  let googleUser
  try {
    googleUser = await getUser(googleSub)
  } catch {
    const res = NextResponse.json({ error: GENERIC }, { status: 502 })
    clearHandoff(res)
    return res
  }

  const result = await linkStandaloneGoogle(primaryUserId, googleUser)
  const primaryCookie = await mintPrimarySessionCookie(primaryUserId, cookieHeader)

  const res = NextResponse.json({
    ok: result === "linked",
    result,
    redirect: `/profile?google=${result}`,
  })
  clearHandoff(res)
  if (primaryCookie) {
    res.cookies.set(SESSION_COOKIE_NAME, primaryCookie, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    })
  }
  return res
}
