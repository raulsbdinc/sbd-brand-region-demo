import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import {
  resolveSigninCredential,
  resolveSharedLoginAlias,
} from "@/lib/credential-resolver"
import { signinResolutionPermitsRealmOperation } from "@/lib/credential-model"
import {
  passwordRealmExchange,
  type VerifiedTokenResponse,
} from "@/lib/auth0-password-grant"
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
  const resolution = await resolveSigninCredential(email)

  // FAIL CLOSED — attempt NO realm and collapse to the same generic 401 as every
  // other cause when the resolution does not permit a realm operation:
  //   • "ambiguous"   — the email collides across credentials (a real shared
  //                     login AND a non-shared credential, or two non-shared).
  //   • "unavailable" — a Management lookup failed, so an incomplete candidate
  //                     set cannot prove a collision/case-3/4 is absent.
  if (!signinResolutionPermitsRealmOperation(resolution.kind)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  let tokenResponse: VerifiedTokenResponse | null = null

  if (resolution.kind === "resolved") {
    // RESOLVED non-shared (case 3 / case 4): attempt ONLY the selected realm,
    // with the email exactly as typed. No shared attempt, no alias fallback —
    // this credential is authoritative for this email on this storefront.
    tokenResponse = await passwordRealmExchange({
      domain,
      clientId,
      clientSecret,
      firstHop,
      username: email,
      password,
      connectionKey: resolution.connectionKey,
    })
  } else {
    // SHARED-DEFAULT (cases 1 & 2, and unknown emails). ATTEMPT 1 — the typed
    // email against the SHARED connection, exactly as before.
    tokenResponse = await passwordRealmExchange({
      domain,
      clientId,
      clientSecret,
      firstHop,
      username: email,
      password,
      connectionKey: "shared",
    })

    // ATTEMPT 2 — SHARED login-alias fallback: treat a VERIFIED alternate email
    // as an alias for the account's ONE shared credential — resolve it to the
    // primary login email and let Auth0 verify the single real password against
    // that. resolveSharedLoginAlias resolves against the SAME shared connection
    // the rest of the credential architecture uses (the live defect was a
    // divergent connection constant here), creates NO second password/identity,
    // and fails CLOSED on an unknown/unverified/ambiguous/unavailable address
    // (only "resolved" retries). It self-gates on Management config, so a
    // shared-primary login pays no extra cost.
    if (!tokenResponse) {
      const alias = await resolveSharedLoginAlias(email)
      if (alias.kind === "resolved") {
        tokenResponse = await passwordRealmExchange({
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
  }

  // STEP 4 — If neither attempt produced a token, collapse EVERY cause (wrong
  // password, unknown user, unverified/unknown alias, blocked) to one generic
  // 401. Never reveal whether an address exists or is an alias — no enumeration.
  // The sign-in guard is intact: a bare email with no sbd-eu database account
  // can never mint a session, because there is no password for Auth0 to verify.
  if (!tokenResponse) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

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

  const session = {
    user: { ...claims, sub },
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
