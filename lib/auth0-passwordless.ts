// AUTH0 PASSWORDLESS EMAIL — ADD AN ALTERNATE SIGN-IN ADDRESS (server-only)
// =========================================================================
// This is the server side of "add another email address" on /profile. The
// business requirement is that the alternate becomes a REAL sign-in identifier
// on the SAME directory record — not a string in a profile field. So the flow
// proves the person holds the mailbox with a one-time passcode, then LINKS that
// proven identity onto the primary account:
//
//   a. POST /passwordless/start { connection: "email", email, send: "code" }
//      → Auth0 emails a 6-digit passcode.                  (startEmailPasscode)
//   b. POST /oauth/token  grant_type ...passwordless/otp, realm "email",
//      username = the address, otp = the code
//      → returns an id_token whose `sub` is a NEW secondary identity, e.g.
//        "email|6a735e27...".                              (verifyEmailPasscode)
//   c. POST /api/v2/users/{primary_sub}/identities { provider: "email",
//      user_id: "<part after the pipe>" } with the Management token
//      → Auth0 MERGES the secondary into the primary. (done in the verify route
//        via lib/auth0-management#linkIdentity)
//
// We deliberately link with the provider + user_id form, NOT { link_with:
// id_token }. Our Management token is minted by a different application than the
// one that issued the id_token, so their `aud` claims can never agree and Auth0
// rejects the link_with form with "JWT (link_with) contains an invalid aud
// claim". The provider + user_id form has no such constraint and is equivalent
// here: ownership is already proven by the passcode we mailed, the id_token was
// only ever a carrier for that same proof.
//
// Credentials are resolved exactly as app/api/signin/password/route.ts does:
// the region comes from the sbd_region cookie, and its domain / client id /
// client secret come from resolveRegionAuthConfig (falling back to the shared
// AUTH0_* vars). The connection name is an env var so a tenant that names its
// passwordless connection differently needs no code change.

import "server-only"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"

/** The tenant's passwordless email connection name (defaults to "email"). */
export const PASSWORDLESS_EMAIL_CONNECTION =
  process.env.AUTH0_PASSWORDLESS_EMAIL_CONNECTION?.trim() || "email"

export interface PasswordlessCreds {
  domain: string
  clientId: string
  clientSecret: string
}

/** A tagged error so the route can map failures to friendly, non-leaky copy. */
export class PasswordlessError extends Error {
  status: number
  /** "config" | "send" | "otp" — lets the route choose the right message. */
  kind: "config" | "send" | "otp"
  constructor(message: string, status: number, kind: "config" | "send" | "otp") {
    super(message)
    this.name = "PasswordlessError"
    this.status = status
    this.kind = kind
  }
}

/**
 * Resolve tenant credentials for the caller's selected region. Returns null
 * when the deployment is misconfigured (missing domain/client id/secret), which
 * the route surfaces as a generic soft error — never as a hint about the
 * address.
 */
export function resolvePasswordlessCreds(
  cookieHeader: string | null,
): PasswordlessCreds | null {
  const region = regionFromCookieHeader(cookieHeader)
  const { domain, clientId, clientSecret } = resolveRegionAuthConfig(region)
  if (!domain || !clientId || !clientSecret) return null
  return { domain, clientId, clientSecret }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return ""
  }
}

/** Decode a JWT payload without verifying — the token came straight from the
 *  tenant over a server-to-server TLS call, so we only need its claims. */
function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1]
  if (!payload) return {}
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  const json = Buffer.from(normalized, "base64").toString("utf8")
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * STEP a — ask Auth0 to email a 6-digit passcode to `email` on the passwordless
 * `email` connection. Throws PasswordlessError("send") if the tenant rejects
 * the request, so the caller can surface a generic retry message.
 */
export async function startEmailPasscode(
  creds: PasswordlessCreds,
  email: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const res = await fetch(`https://${creds.domain}/passwordless/start`, {
    signal: options.signal,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      connection: PASSWORDLESS_EMAIL_CONNECTION,
      email,
      send: "code",
    }),
    cache: "no-store",
  })
  if (!res.ok) {
    throw new PasswordlessError(
      `passwordless/start failed (${res.status}). ${await safeText(res)}`,
      res.status,
      "send",
    )
  }
}

export interface VerifiedIdentity {
  /** The secondary identity anchor, e.g. "email|6a735e27...". */
  sub: string
  /** The identity provider — "email" for a passwordless email identity. */
  provider: string
  /** The part after the pipe — passed to the Management link call. */
  userId: string
}

/**
 * STEP b — exchange the passcode for tokens with the passwordless OTP grant and
 * return the NEW secondary identity encoded in the id_token's `sub`. Throws
 * PasswordlessError("otp") when the code is wrong/expired so the caller can ask
 * the person to re-enter it.
 */
export async function verifyEmailPasscode(
  creds: PasswordlessCreds,
  email: string,
  code: string,
): Promise<VerifiedIdentity> {
  const res = await fetch(`https://${creds.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "http://auth0.com/oauth/grant-type/passwordless/otp",
      realm: PASSWORDLESS_EMAIL_CONNECTION,
      username: email,
      otp: code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "openid profile email",
    }),
    cache: "no-store",
  })

  if (!res.ok) {
    // A wrong/expired code is the expected failure here — everything else also
    // collapses to the same "code isn't right" message so we never leak detail.
    throw new PasswordlessError(
      `passwordless otp grant failed (${res.status}). ${await safeText(res)}`,
      res.status,
      "otp",
    )
  }

  const json = (await res.json()) as { id_token?: string }
  const claims = json.id_token ? decodeJwtClaims(json.id_token) : {}
  const sub = typeof claims.sub === "string" ? claims.sub : ""
  const pipe = sub.indexOf("|")
  if (!sub || pipe < 0) {
    throw new PasswordlessError(
      "passwordless otp grant returned no usable identity",
      502,
      "otp",
    )
  }
  return {
    sub,
    provider: sub.slice(0, pipe),
    userId: sub.slice(pipe + 1),
  }
}
