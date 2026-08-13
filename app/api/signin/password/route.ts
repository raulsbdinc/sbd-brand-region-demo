import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"
import { getUsersByEmail, isManagementConfigured } from "@/lib/auth0-management"

export const runtime = "nodejs"

// The SDK hard-codes a 1-hour expiry inside generateSessionCookie (see step 5
// comment below), so the cookie maxAge MUST match to avoid the browser holding
// a cookie the encrypted payload already considers expired.
const SESSION_TTL_SECONDS = 60 * 60
const SESSION_COOKIE_NAME = "__session"

// One generic message for every credential failure. Never say whether the
// address exists — that would enable user enumeration.
const GENERIC_ERROR = "That email or password isn't right."

interface PasswordRealmTokenResponse {
  access_token: string
  id_token?: string
  scope?: string
  expires_in?: number
  token_type?: string
}

/** Decode a JWT payload without verifying — the token came straight from the
 *  tenant over a server-to-server TLS call, so we only need its claims. */
function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1]
  if (!payload) return {}
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  const json = Buffer.from(normalized, "base64").toString("utf8")
  return JSON.parse(json) as Record<string, unknown>
}

/** A token response we've confirmed carries the tokens the session needs. */
type VerifiedTokenResponse = PasswordRealmTokenResponse & { id_token: string }

/**
 * ONE password-realm exchange against the sbd-eu database connection. Returns
 * the token set on success, or `null` for ANY failure (wrong password, unknown
 * user, blocked, network) — the caller decides what a null means, and every
 * caller-visible failure still collapses to the single generic 401 below. The
 * password is only ever verified here, by Auth0; we never see or store it.
 */
async function passwordRealmExchange(params: {
  domain: string
  clientId: string
  clientSecret: string
  firstHop: string
  username: string
  password: string
}): Promise<VerifiedTokenResponse | null> {
  const { domain, clientId, clientSecret, firstHop, username, password } = params
  try {
    const res = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Forward the caller's first x-forwarded-for hop as auth0-forwarded-for
        // so Auth0 brute-force protection attributes failures to the real
        // end-user IP, not the shared Vercel egress IP (which would lock the
        // whole demo out after 10 attempts). The tenant apps have
        // trust-token-endpoint-IP-header enabled so this header is honoured.
        ...(firstHop ? { "auth0-forwarded-for": firstHop } : {}),
      },
      body: JSON.stringify({
        grant_type: "http://auth0.com/oauth/grant-type/password-realm",
        realm: PASSWORD_CONNECTION,
        username,
        password,
        scope: "openid profile email",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as PasswordRealmTokenResponse
    if (!json.access_token || !json.id_token) return null
    return json as VerifiedTokenResponse
  } catch {
    return null
  }
}

/**
 * LOGIN-ALIAS resolution (no new password store, no duplicate users).
 *
 * A verified ALTERNATE email is a linked passwordless `email` identity on the
 * account (added only after mailbox proof in the alternate-email flow), so it
 * carries no password of its own. To let "same person, same password, either
 * email" work, we resolve the typed alternate to the account's ONE primary
 * database login email and let Auth0 verify the single real credential against
 * that. Returns the primary login email to retry with, or `null` if the typed
 * address is not a verified alias of a database-backed account here.
 *
 * PRIVACY: any null (unknown address, not database-backed, not verified) is
 * indistinguishable to the client — the caller returns the same generic 401.
 */
async function resolvePrimaryLoginEmail(
  typedEmail: string,
): Promise<string | null> {
  try {
    const typed = typedEmail.toLowerCase()
    const matches = await getUsersByEmail(typed)

    // The account must be backed by THIS deployment's sbd-eu database
    // connection: an identity with provider "auth0" on PASSWORD_CONNECTION. If
    // more than one record shares the address (e.g. a stray passwordless-only
    // record), this picks the database-backed one; if none is, we don't resolve.
    const dbUser = matches.find((u) =>
      (u.identities ?? []).some(
        (id) => id.provider === "auth0" && id.connection === PASSWORD_CONNECTION,
      ),
    )
    if (!dbUser?.email) return null

    // The typed address must be VERIFIED on that profile. Accept the root email
    // when email_verified is true; accept a linked identity's email because the
    // alternate-email flow only links after mailbox proof (honour an explicit
    // email_verified === false on the identity if the directory ever sets one).
    const rootVerified =
      dbUser.email.toLowerCase() === typed && dbUser.email_verified === true
    const linkedVerified = (dbUser.identities ?? []).some((id) => {
      const idEmail = (id.profileData?.email as string | undefined)?.toLowerCase()
      return idEmail === typed && id.profileData?.email_verified !== false
    })
    if (!rootVerified && !linkedVerified) return null

    // Retry only if it actually changes the username — if the primary email IS
    // the typed address, attempt 1 already tried it (so this was a wrong
    // password, a genuine failure), and a second identical call is pointless.
    if (dbUser.email.toLowerCase() === typed) return null
    return dbUser.email
  } catch (err) {
    console.log("[v0] password alias resolution failed:", (err as Error).message)
    return null
  }
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

  // ATTEMPT 1 — today's behavior, UNCHANGED: verify the password with the email
  // exactly as typed. This still succeeds for the account's PRIMARY email at no
  // extra cost, and — crucially — makes NO Management call on a normal login.
  let tokenResponse = await passwordRealmExchange({
    domain,
    clientId,
    clientSecret,
    firstHop,
    username: email,
    password,
  })

  // ATTEMPT 2 — login-alias fallback. Runs ONLY when attempt 1 failed (a typed
  // alternate email, or simply a wrong password), so a successful primary-email
  // login never pays for the extra Management lookup. Treat a VERIFIED alternate
  // email as an alias for the account's one database credential: resolve it to
  // the primary login email and let Auth0 verify the single real password
  // against that. No second password store, no duplicate user, no crypto.
  if (!tokenResponse && isManagementConfigured()) {
    const primaryEmail = await resolvePrimaryLoginEmail(email)
    if (primaryEmail) {
      tokenResponse = await passwordRealmExchange({
        domain,
        clientId,
        clientSecret,
        firstHop,
        username: primaryEmail,
        password,
      })
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

  const session = {
    user: claims,
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
  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
  return response
}
