// REAL AUTH0 CLIENT (server-side)
// ================================
// This is the live Auth0 integration for the "Try it live" flow. It is separate
// from the mock showcase in lib/auth-service.ts: the mock powers the cinematic
// custom sign-in screens, while this client performs a real redirect-based
// Universal Login against the SBD demo tenant.
//
// SDK: @auth0/nextjs-auth0 v4 (server-side, encrypted cookie sessions).
// Routes are mounted automatically by the proxy (see proxy.ts):
//   /auth/login  /auth/logout  /auth/callback  /auth/profile  /auth/access-token
//
// Required env vars (see FEATURE_BACKLOG.md):
//   AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET
//   APP_BASE_URL is intentionally omitted so the SDK infers the base URL from
//   the request host — this keeps dynamic preview URLs working. Auth0's
//   "Allowed Callback URLs" list is the safety net for that inference.

import { Auth0Client } from "@auth0/nextjs-auth0/server"
import { authCallbackHandler } from "@/lib/auth-callback"

export const auth0 = new Auth0Client({
  // Land failed sign-ins (e.g. a blocked/deactivated user) on /auth-error
  // instead of dumping the raw Auth0 error. See lib/auth-callback.ts.
  onCallback: authCallbackHandler,
  authorizationParameters: {
    // Request the standard OIDC profile and, when AUTH0_AUDIENCE is set, a
    // JWT access token for that explicitly configured SBD API.
    //
    // NOTE: we intentionally do NOT request `offline_access` here. That scope
    // adds a refresh token to the session, which pushes the encrypted session
    // cookie past the ~4KB browser limit. The SDK then splits it into chunks
    // (`__session.0`, `__session.1`, ...). Because the proxy middleware "rolls"
    // (re-encrypts) the session on every request — and the header (`/api/me`)
    // and token inspector (`/api/token-inspector`) fire concurrently on each
    // navigation — multiple responses would rewrite the chunked cookie at once
    // with fresh encryption, corrupting the chunk set. The next read then fails
    // to decrypt and the session appears to vanish (e.g. /account bouncing to
    // /pathways after a successful login). Keeping the session in a single,
    // un-chunked cookie makes rolling last-write-wins and always valid.
    //
    // When we later wire the BFF proxy to call SBD APIs and genuinely need a
    // refresh token, re-add `offline_access` together with a server-side
    // (stateless -> stateful) session store so the large token set lives on the
    // server instead of the cookie.
    scope: "openid profile email",
    ...(process.env.AUTH0_AUDIENCE
      ? { audience: process.env.AUTH0_AUDIENCE }
      : {}),
  },
  // After a successful login, send the user to the live result page.
  signInReturnToPath: "/live",
})

/**
 * Whether the real Auth0 integration is fully configured. Used by the proxy,
 * the /live page, and the server layout (to tell promoted client flows whether
 * they can perform a real redirect). All four vars are required for a working
 * Regular Web App login.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET &&
      process.env.AUTH0_SECRET,
  )
}
