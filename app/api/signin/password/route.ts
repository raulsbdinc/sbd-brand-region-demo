import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"
import { searchUsers, isManagementConfigured } from "@/lib/auth0-management"
import {
  connectionNameForKey,
  resolveSigninCredential,
} from "@/lib/credential-resolver"
import type { ConnectionKey } from "@/lib/credential-model"

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
 * ONE password-realm exchange against a RESOLVED internal connection key.
 *
 * The caller passes an allow-listed ConnectionKey (never a raw realm from the
 * browser); we translate it to the tenant connection name server-side here. A
 * key that has no configured connection name yields `null` (nothing to try).
 *
 * Returns the token set on success, or `null` for ANY failure (wrong password,
 * unknown user, blocked, network) — the caller decides what a null means, and
 * every caller-visible failure still collapses to the single generic 401 below.
 * The password is only ever verified here, by Auth0; we never see or store it.
 */
async function passwordRealmExchange(params: {
  domain: string
  clientId: string
  clientSecret: string
  firstHop: string
  username: string
  password: string
  connectionKey: ConnectionKey
}): Promise<VerifiedTokenResponse | null> {
  const { domain, clientId, clientSecret, firstHop, username, password, connectionKey } =
    params
  const realm = connectionNameForKey(connectionKey)
  if (!realm) return null
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
        realm,
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

/** Escape a value for safe interpolation into a Lucene phrase query. The typed
 *  email contains `+ . @` and could contain Lucene metacharacters; we quote it
 *  as a phrase and backslash-escape backslashes and embedded double quotes so
 *  it can never break out of the quoted term. */
function luceneEscapePhrase(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * LOGIN-ALIAS resolution (no new password store, no duplicate users).
 *
 * A verified ALTERNATE email is a linked passwordless `email` identity on the
 * account, so it carries no password of its own AND is NOT its root email —
 * which is why users-by-email (root-email only) never found it. Instead we
 * resolve against the alternate we PERSISTED on the primary's app_metadata
 * (`login_alias_emails`) when the address was linked; app_metadata is the one
 * reliably searchable place (the search index does not return linked-identity
 * emails and is eventually consistent, which is fine here — an alternate is
 * added, then used to sign in later). Returns the account's ONE primary login
 * email to retry with, or `null` if the typed address is not a verified alias
 * of a database-backed account here.
 *
 * PRIVACY: any null (unknown address, not database-backed, not a real alias) is
 * indistinguishable to the client — the caller returns the same generic 401.
 */
async function resolvePrimaryLoginEmail(
  typedEmail: string,
): Promise<string | null> {
  const typed = typedEmail.toLowerCase()
  const q = luceneEscapePhrase(typed)

  // Find the primary by its PERSISTED alias list, and — belt and suspenders —
  // by root email too. We query only fields we control (app_metadata) or the
  // root email; never a linked identity's address (not indexed, per DEMO_STATUS).
  const query = `app_metadata.login_alias_emails:"${q}" OR email:"${q}"`
  const matches = await searchUsers(query)

  // The account must be backed by THIS deployment's sbd-eu database connection:
  // an identity with provider "auth0" on PASSWORD_CONNECTION. If several records
  // come back, pick the database-backed one; if none is, don't resolve.
  const dbUser = matches.find((u) =>
    (u.identities ?? []).some(
      (id) => id.provider === "auth0" && id.connection === PASSWORD_CONNECTION,
    ),
  )
  if (!dbUser?.email) return null

  // NEVER substitute on a loose search match. Confirm the typed address is
  // genuinely one of this account's persisted aliases, or its verified root
  // email, before we retry the password against the primary.
  const aliasList = Array.isArray(dbUser.app_metadata?.login_alias_emails)
    ? (dbUser.app_metadata!.login_alias_emails as unknown[]).filter(
        (e): e is string => typeof e === "string",
      )
    : []
  const isPersistedAlias = aliasList.some((e) => e.toLowerCase() === typed)
  const isVerifiedRoot =
    dbUser.email.toLowerCase() === typed && dbUser.email_verified === true
  if (!isPersistedAlias && !isVerifiedRoot) return null

  // Retry only if it actually changes the username — if the primary email IS
  // the typed address, attempt 1 already tried it (so this was a wrong
  // password, a genuine failure) and a second identical call is pointless.
  if (dbUser.email.toLowerCase() === typed) return null
  return dbUser.email
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

  // ATTEMPT 1 — today's behavior, UNCHANGED for cases 1 & 2: verify the password
  // with the email exactly as typed against the SHARED (sbd-eu) connection. This
  // still succeeds for the account's PRIMARY email at no extra cost, and —
  // crucially — makes NO Management call on a normal login.
  let tokenResponse = await passwordRealmExchange({
    domain,
    clientId,
    clientSecret,
    firstHop,
    username: email,
    password,
    connectionKey: "shared",
  })

  // ATTEMPT 2 — connection-aware resolution + login-alias fallback. Runs ONLY
  // when attempt 1 failed (a case-3/4 identity, a typed alternate email, or a
  // wrong password), so a successful shared-primary login never pays for the
  // extra Management lookup.
  if (!tokenResponse && isManagementConfigured()) {
    // Resolve — entirely server-side — whether this email + SITE_BRAND maps to a
    // per-email (case 3) or per-brand (case 4) database credential. A unique,
    // brand-permitted, identity-backed binding resolves to that connection; an
    // ambiguous/no match resolves to null and we fall through to the shared
    // alias path. The connection key is the only thing that leaves the resolver.
    const resolved = await resolveSigninCredential(email)
    if (resolved && resolved.connectionKey !== "shared") {
      tokenResponse = await passwordRealmExchange({
        domain,
        clientId,
        clientSecret,
        firstHop,
        username: email,
        password,
        connectionKey: resolved.connectionKey,
      })
    } else {
      // SHARED alias fallback (unchanged): treat a VERIFIED alternate email as an
      // alias for the account's one shared credential — resolve it to the primary
      // login email and let Auth0 verify the single real password against that.
      const primaryEmail = await resolvePrimaryLoginEmail(email)
      if (primaryEmail) {
        tokenResponse = await passwordRealmExchange({
          domain,
          clientId,
          clientSecret,
          firstHop,
          username: primaryEmail,
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
  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
  return response
}
