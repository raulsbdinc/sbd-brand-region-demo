// PASSWORD-REALM GRANT (server-only)
// ==================================
// One shared server-to-server password verification against a RESOLVED internal
// connection key. Extracted verbatim from app/api/signin/password so both the
// sign-in path AND the Model-4 cross-brand "prove you know an existing password"
// proof verify credentials the SAME way — the password is only ever checked by
// Auth0, never seen or stored here.
//
// The caller passes an allow-listed ConnectionKey (never a raw realm from the
// browser); it is translated to the tenant connection name server-side. A key
// with no configured connection name yields null (nothing to try). Returns the
// verified token set on success, or null for ANY failure (wrong password,
// unknown user, blocked, network) — the caller decides what null means.

import "server-only"
import { connectionNameForKey } from "@/lib/credential-resolver"
import type { ConnectionKey } from "@/lib/credential-model"

interface PasswordRealmTokenResponse {
  access_token: string
  id_token?: string
  scope?: string
  expires_in?: number
  token_type?: string
}

/** A token response we've confirmed carries the tokens a session needs. */
export type VerifiedTokenResponse = PasswordRealmTokenResponse & { id_token: string }

export async function passwordRealmExchange(params: {
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
