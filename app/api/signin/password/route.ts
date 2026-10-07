import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { resolveSigninCredential } from "@/lib/credential-resolver"
import { runBrandPasswordSignin, SIGNIN_GENERIC_ERROR } from "@/lib/brand-signin-core"
import { brandVerifiedUser } from "@/lib/brand-session-gate"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { passwordRealmGrant } from "@/lib/auth0-password-grant"
import {
  INTERACTIVE_LOOKUP_BUDGET_MS,
  INTERACTIVE_SIGNIN_BUDGET_MS,
} from "@/lib/password-grant-core"
import {
  applySessionCookie,
  SESSION_TTL_SECONDS,
} from "@/lib/session-cookie"

export const runtime = "nodejs"

// One generic message for every credential failure. Never say whether the
// address exists — that would enable user enumeration.
const GENERIC_ERROR = SIGNIN_GENERIC_ERROR

export async function POST(request: NextRequest) {
  let email: string
  let password: string
  try {
    const body = await request.json()
    email = typeof body?.email === "string" ? body.email.trim() : ""
    password = typeof body?.password === "string" ? body.password : ""
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  if (!email || !password) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  // STEP 1 — Resolve tenant credentials + connection exactly as the rest of the
  // app does: the region comes from the sbd_region cookie, and its domain /
  // client id / client secret come from resolveRegionAuthConfig (which falls
  // back to the shared AUTH0_* vars). The realm is this deployment's connection.
  const region = regionFromCookieHeader(request.headers.get("cookie"))
  const { domain, clientId, clientSecret, secret } =
    resolveRegionAuthConfig(region)

  if (!domain || !clientId || !clientSecret || !secret) {
    // Misconfigured deployment — still don't leak specifics to the client.
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  // STEP 2 — Exchange credentials at the tenant token endpoint using the
  // password-realm grant. This is server-to-server (the secret never touches
  // the browser), which is why it needs no custom domain and no third-party
  // cookies. The forwarded-for hop is preserved inside passwordRealmExchange.
  const firstHop = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim()

  // RESOLVE FIRST, then ONE grant against the bound brand realm with that brand
  // identity's own username, then confirm the returned subject is the
  // canonical owner the resolver selected (runBrandPasswordSignin). Ambiguous,
  // unresolved and owner-mismatch outcomes are the same generic 401; a failed
  // lookup or provider error is 503 and throttling 429. No session otherwise.
  const outcome = await runBrandPasswordSignin(
    {
      email,
      password,
      lookupBudgetMs: INTERACTIVE_LOOKUP_BUDGET_MS,
      signinBudgetMs: INTERACTIVE_SIGNIN_BUDGET_MS,
    },
    {
      now: Date.now,
      resolve: (typed, opts) => resolveSigninCredential(typed, SITE_BRAND, opts),
      grant: ({ username, password: pw, connectionKey, deadlineAt }) =>
        passwordRealmGrant({
          domain,
          clientId,
          clientSecret,
          firstHop,
          username,
          password: pw,
          connectionKey,
          deadlineAt,
        }),
    },
  )
  if (outcome.kind !== "session") {
    return NextResponse.json(outcome.body, {
      status: outcome.status,
      headers: outcome.headers,
    })
  }
  const tokenResponse = outcome.tokens
  const claims = outcome.claims
  const sub = outcome.sub

  // STEP 5 — Mint a session cookie the SDK can read back.
  // We use generateSessionCookie from the SDK's /testing subpath deliberately:
  // it is the SDK's own encrypt() bound to the same AUTH0_SECRET, so the payload
  // decrypts on every getSession() read. v4 exposes no supported setSession() in
  // a route handler, so this is the only in-SDK way to establish a session from
  // a token set we minted ourselves. generateSessionCookie hard-codes a 1-hour
  // expiry, so we set the cookie maxAge to SESSION_TTL_SECONDS to match.
  const now = Math.floor(Date.now() / 1000)

  // Verified for this storefront only when the password was checked on THIS
  // brand's realm; anything else stays unstamped and the proxy gate holds it.
  const user =
    outcome.connectionKey === SITE_BRAND
      ? brandVerifiedUser({ ...claims, sub }, SITE_MARKET, SITE_BRAND)
      : { ...claims, sub }
  const session = {
    user,
    tokenSet: {
      accessToken: tokenResponse.access_token,
      idToken: tokenResponse.id_token,
      scope: tokenResponse.scope,
      expiresAt: now + (tokenResponse.expires_in ?? SESSION_TTL_SECONDS),
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
  // Persist via the SDK-faithful chunked writer so a large shared-account
  // session (linked identities + alias metadata + multi-site history) is never
  // silently dropped by the browser's ~4KB single-cookie limit. Pass the
  // request's cookie names so any stale chunks from a prior session are cleared.
  applySessionCookie(
    response.cookies,
    cookieValue,
    request.cookies.getAll().map((c) => c.name),
    { maxAge: SESSION_TTL_SECONDS },
  )
  return response
}
