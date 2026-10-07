import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { resolveSigninCredential } from "@/lib/credential-resolver"
import { signinResolutionPermitsRealmOperation } from "@/lib/credential-model"
import { brandVerifiedUser } from "@/lib/brand-session-gate"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { passwordRealmGrant } from "@/lib/auth0-password-grant"
import {
  INTERACTIVE_LOOKUP_BUDGET_MS,
  INTERACTIVE_SIGNIN_BUDGET_MS,
  signinFailureResponse,
} from "@/lib/password-grant-core"
import {
  applySessionCookie,
  SESSION_TTL_SECONDS,
} from "@/lib/session-cookie"

export const runtime = "nodejs"

// One generic message for every credential failure. Never say whether the
// address exists — that would enable user enumeration.
const GENERIC_ERROR = "That email or password isn't right."

/** Decode a JWT payload without verifying — the token came straight from the
 *  tenant over a server-to-server TLS call, so we only need its claims. */
function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1]
  if (!payload) return {}
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  const json = Buffer.from(normalized, "base64").toString("utf8")
  return JSON.parse(json) as Record<string, unknown>
}

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

  // RESOLVE FIRST — before touching any realm. We must NEVER try shared before
  // checking whether this email maps to a non-shared credential or is ambiguous:
  // a shared credential could otherwise win for an email that also has a case-3/4
  // binding. The resolver is entirely server-side; only a ConnectionKey (never a
  // raw realm) crosses back. When Management isn't configured it collapses to
  // "shared-default", so cases 1 & 2 still work with no Management call.
  // One deadline bounds every provider call in this request. The lookup gets
  // its own shorter share so the password check always has time left.
  const startedAt = Date.now()
  const deadlineAt = startedAt + INTERACTIVE_SIGNIN_BUDGET_MS
  const resolution = await resolveSigninCredential(email, SITE_BRAND, {
    deadlineAt: startedAt + INTERACTIVE_LOOKUP_BUDGET_MS,
  })

  // FAIL CLOSED: attempt NO realm when the resolution does not permit one.
  //   • "unavailable": a Management lookup failed or timed out. That is a
  //     provider problem, not a credential refusal, so it is reported as 503.
  //     The answer does not depend on whether the address exists.
  //   • "ambiguous" and anything else: the same generic 401 as a bad password.
  if (resolution.kind === "unavailable") {
    const failure = signinFailureResponse("unavailable")
    return NextResponse.json(failure.body, { status: failure.status })
  }
  if (!signinResolutionPermitsRealmOperation(resolution.kind)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  // Model 4 only: the resolution is "resolved" here (the gate above rejects
  // everything else). Attempt ONLY the bound brand/per-email realm with the
  // email as typed. There is no shared attempt and no shared login alias.
  if (resolution.kind !== "resolved") {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }
  // Sent once, never retried, and bounded by the shared deadline. The username
  // is the brand identity's OWN login email: identical to the typed email for
  // an exact match, or the enrollment email when a verified alias of the same
  // canonical customer signs in (CIAM-21). Still only this brand's one realm.
  const grant = await passwordRealmGrant({
    domain,
    clientId,
    clientSecret,
    firstHop,
    username: resolution.loginEmail,
    password,
    connectionKey: resolution.connectionKey,
    deadlineAt,
  })

  // STEP 4: Auth0's credential refusal (wrong password, unknown user, blocked)
  // stays one generic 401 so nothing reveals whether an address exists.
  // Attack-protection throttling is 429 and a timeout or provider error is 503,
  // so an outage is never shown to the customer as a wrong password.
  if (grant.kind !== "ok") {
    const failure = signinFailureResponse(
      grant.kind,
      grant.kind === "throttled" ? grant.retryAfterSeconds : undefined,
    )
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: failure.headers,
    })
  }
  const tokenResponse = grant.tokens

  // STEP 5 — Mint a session cookie the SDK can read back.
  // We use generateSessionCookie from the SDK's /testing subpath deliberately:
  // it is the SDK's own encrypt() bound to the same AUTH0_SECRET, so the payload
  // decrypts on every getSession() read. v4 exposes no supported setSession() in
  // a route handler, so this is the only in-SDK way to establish a session from
  // a token set we minted ourselves. generateSessionCookie hard-codes a 1-hour
  // expiry, so we set the cookie maxAge to SESSION_TTL_SECONDS to match.
  const claims = decodeJwtClaims(tokenResponse.id_token)
  const now = Math.floor(Date.now() / 1000)

  // The SDK's SessionData.user requires a string `sub`; the decoded claims type
  // it only as unknown, so pin it explicitly (it is always present on a verified
  // id_token) to satisfy the session shape.
  const sub = typeof claims.sub === "string" ? claims.sub : ""

  // Verified for this storefront only when the password was checked on THIS
  // brand's realm; anything else stays unstamped and the proxy gate holds it.
  const user =
    resolution.connectionKey === SITE_BRAND
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
