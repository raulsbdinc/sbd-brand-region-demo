// CANONICAL LOGOUT — single source of truth
// ==========================================
// Ending a session happens in exactly ONE place in this app: useApp().logout()
// (see components/app-providers.tsx). Every sign-out affordance — the header
// dropdown, /welcome, /live, the account center, and the mock showcase screens
// — calls that method instead of rolling its own. As mock methods are promoted
// to real Auth0, no logout code has to change.
//
// LOCAL logout (no federated Auth0 logout). When Auth0 is configured, logout()
// navigates to the app's own GET /api/account/logout route, which clears the
// __session cookie (and its split chunk variants) and returns the person to the
// demo home on OUR origin. It intentionally does NOT hit Auth0's hosted
// /v2/logout endpoint, so the customer never leaves the demo site for the
// Auth0-branded "Are you sure you want to log out" page on auth0app.com.
//
// This is correct for the demo because sign-in is EMBEDDED: password and
// passcode mint the app's own __session cookie (there is no browser Auth0 SSO
// session to end), Google sign-in already uses prompt=login (so a persisted IdP
// session never causes a silent re-login), and the per-domain __session
// boundary the demo relies on is unaffected. The SDK's /auth/logout mount in
// proxy.ts is left in place but is no longer used by the UI.

export const LOCAL_LOGOUT_PATH = "/api/account/logout"

/**
 * Build the URL for the local logout route.
 *
 * The route always redirects to the app's home on the same origin, so no
 * `returnTo` is needed in the common case. The optional `returnTo` is retained
 * for signature compatibility with existing callers; when passed it is appended
 * as a query param (the route currently ignores it and always returns home).
 *
 * @param returnTo Optional same-origin path to return to. Omit for the home
 *                 page (the common case).
 */
export function buildLogoutUrl(returnTo?: string): string {
  if (!returnTo) return LOCAL_LOGOUT_PATH
  const params = new URLSearchParams({ returnTo })
  return `${LOCAL_LOGOUT_PATH}?${params.toString()}`
}
