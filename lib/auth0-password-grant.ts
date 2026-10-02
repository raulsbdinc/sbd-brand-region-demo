// PASSWORD-REALM GRANT (server-only)
// ==================================
// One shared server-to-server password verification against a RESOLVED internal
// connection key, used by sign-in and by the flows that ask for an existing
// password as proof. The password is only ever checked by Auth0, never seen or
// stored here.
//
// The caller passes an allow-listed ConnectionKey (never a raw realm from the
// browser); it is translated to the tenant connection name server-side. The
// attempt is sent once, with a hard timeout, and is never retried.

import "server-only"
import { connectionNameForKey } from "@/lib/credential-resolver"
import type { ConnectionKey } from "@/lib/credential-model"
import {
  runPasswordGrant,
  type PasswordGrantOutcome,
  type PasswordGrantTokens,
} from "@/lib/password-grant-core"

/** A token response we've confirmed carries the tokens a session needs. */
export type VerifiedTokenResponse = PasswordGrantTokens

interface PasswordRealmParams {
  domain: string
  clientId: string
  clientSecret: string
  firstHop: string
  username: string
  password: string
  connectionKey: ConnectionKey
  /** Absolute epoch-ms deadline shared with the rest of the interactive request. */
  deadlineAt?: number
}

/**
 * The password check with its real outcome: ok, refused by Auth0, throttled by
 * attack protection, or unavailable (timeout, network or provider error).
 * Forwards the caller's first x-forwarded-for hop as auth0-forwarded-for so
 * brute-force protection attributes failures to the end user, not the shared
 * Vercel egress IP.
 */
export async function passwordRealmGrant(
  params: PasswordRealmParams,
): Promise<PasswordGrantOutcome> {
  const realm = connectionNameForKey(params.connectionKey)
  if (!realm) return { kind: "unavailable" }
  return runPasswordGrant({
    fetchImpl: fetch,
    domain: params.domain,
    firstHop: params.firstHop,
    deadlineAt: params.deadlineAt,
    body: {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      realm,
      username: params.username,
      password: params.password,
      scope: "openid profile email",
      client_id: params.clientId,
      client_secret: params.clientSecret,
    },
  })
}

/** Token set on success, or null for any failure. Same bounded single attempt. */
export async function passwordRealmExchange(
  params: PasswordRealmParams,
): Promise<VerifiedTokenResponse | null> {
  const outcome = await passwordRealmGrant(params)
  return outcome.kind === "ok" ? outcome.tokens : null
}
