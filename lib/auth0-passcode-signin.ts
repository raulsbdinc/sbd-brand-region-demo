// PASSCODE SIGN-IN — SERVER-SIDE FLOW RESOLUTION (server-only)
// ============================================================
// Part 3 of the customer-profile work: signing IN with an email passcode, where
// the address may be either
//   - a DATABASE user (the account's primary email), or
//   - a linked ALTERNATE that lives on the passwordless "email" connection.
//
// These are two different Auth0 flows and the drawer must pick the right one.
// The whole choice happens HERE, on the server, and is NEVER visible to the
// client: if the response revealed which flow ran, it would be an email
// enumeration oracle (an attacker could learn whether an address is a database
// user). So both the start and verify routes return the SAME generic shape
// regardless of which branch executed.
//
// RESOLUTION RULE (verified against the tenant):
//   - Look the address up with the Management API's users-by-email — a DIRECT
//     lookup, NOT the search index. The search index does not return linked
//     identities and is eventually consistent, so it must never sit in a
//     sign-in path.
//   - If a returned user holds an identity on our DATABASE connection → DATABASE
//     flow.
//   - Otherwise → PASSWORDLESS flow. A linked alternate lands here: once linked,
//     Auth0 merges the secondary record and the address no longer resolves as
//     its own user, so users-by-email returns no database-connection identity
//     for it.

import "server-only"
import { getUsersByEmail, type Auth0User } from "@/lib/auth0-management"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"
import {
  PASSWORDLESS_EMAIL_CONNECTION,
  type PasswordlessCreds,
} from "@/lib/auth0-passwordless"

/** Which flow the address resolved to. Kept server-side only. */
export type PasscodeFlow = "database" | "passwordless"

/** Decode a JWT payload without verifying — the token came straight from the
 *  tenant over a server-to-server TLS call, so we only need its claims. */
export function decodeJwtClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1]
  if (!payload) return {}
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  try {
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<
      string,
      unknown
    >
  } catch {
    return {}
  }
}

/**
 * Decide which flow an address takes, using the DIRECT users-by-email lookup.
 * Returns "database" only when a returned record holds an identity on our
 * database connection; everything else (including "no such user" and any lookup
 * error) falls to "passwordless". Falling back on error is safe: the
 * passwordless verify step has its own hard guard (a bare email|… sub is
 * rejected), so a mis-resolved address still cannot mint a session.
 */
export async function resolvePasscodeFlow(email: string): Promise<PasscodeFlow> {
  let users: Auth0User[] = []
  try {
    users = await getUsersByEmail(email)
  } catch {
    // Never let a lookup blip reveal anything or block sign-in — treat as
    // passwordless and rely on the verify-step sub guard.
    return "passwordless"
  }

  const hasDbIdentity = users.some((u) =>
    (u.identities ?? []).some((id) => id.connection === PASSWORD_CONNECTION),
  )
  return hasDbIdentity ? "database" : "passwordless"
}

/**
 * DATABASE flow, step 1 — POST /otp/challenge to send a code on the database
 * connection. Returns the opaque auth_session the verify step needs. Throws on
 * any non-2xx so the caller collapses it to the generic "we sent a code" shape
 * (the response is identical whether or not the address exists).
 */
export async function startDatabaseChallenge(
  creds: PasswordlessCreds,
  email: string,
): Promise<string> {
  const res = await fetch(`https://${creds.domain}/otp/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      connection: PASSWORD_CONNECTION,
      email,
      allow_signup: false,
    }),
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`otp/challenge failed (${res.status})`)
  }
  const json = (await res.json().catch(() => ({}))) as { auth_session?: string }
  return json.auth_session ?? ""
}

/**
 * DATABASE flow, step 2 — exchange auth_session + otp for tokens. Returns the
 * decoded id_token claims (used to mint the session). Throws on non-2xx.
 */
export async function verifyDatabaseOtp(
  creds: PasswordlessCreds,
  authSession: string,
  otp: string,
): Promise<{ claims: Record<string, unknown>; tokens: TokenSet }> {
  const res = await fetch(`https://${creds.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "http://auth0.com/oauth/grant-type/passwordless/otp",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      auth_session: authSession,
      otp,
      scope: "openid profile email",
    }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`database otp token exchange failed (${res.status})`)
  return toClaims(await res.json())
}

/**
 * PASSWORDLESS flow, step 2 — exchange the code for tokens on the "email"
 * connection (realm "email", username = the address). Returns the decoded
 * id_token claims + tokens. Throws on non-2xx.
 */
export async function verifyPasswordlessOtp(
  creds: PasswordlessCreds,
  email: string,
  otp: string,
): Promise<{ claims: Record<string, unknown>; tokens: TokenSet }> {
  const res = await fetch(`https://${creds.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "http://auth0.com/oauth/grant-type/passwordless/otp",
      realm: PASSWORDLESS_EMAIL_CONNECTION,
      username: email,
      otp,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "openid profile email",
    }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`passwordless otp token exchange failed (${res.status})`)
  return toClaims(await res.json())
}

export interface TokenSet {
  access_token?: string
  id_token?: string
  scope?: string
  expires_in?: number
}

function toClaims(raw: unknown): {
  claims: Record<string, unknown>
  tokens: TokenSet
} {
  const tokens = (raw ?? {}) as TokenSet
  const claims = tokens.id_token ? decodeJwtClaims(tokens.id_token) : {}
  return { claims, tokens }
}

/**
 * THE PASSWORDLESS SUB GUARD.
 * On the passwordless flow, inspect the `sub` in the returned id_token:
 *   - A LINKED alternate returns the PRIMARY sub ("auth0|…" — a database anchor)
 *     because Auth0 resolved the link. That is a real sign-in → allow.
 *   - An address nobody has linked returns a bare "email|…" sub, meaning Auth0
 *     just minted a brand-new EMPTY passwordless user. That is NOT an account on
 *     this storefront → reject, so no session is created.
 * Without this guard any address in the world could sign in and land on an empty
 * account.
 */
export function passwordlessSubIsRealAccount(sub: unknown): boolean {
  return typeof sub === "string" && sub.length > 0 && !sub.startsWith("email|")
}
