// CANONICAL LOGOUT — single source of truth
// ==========================================
// Ending a session happens in exactly ONE place in this app: useApp().logout()
// (see components/app-providers.tsx). Every sign-out affordance — the header
// dropdown, /welcome, /live, the account center, and the mock showcase screens
// — calls that method instead of rolling its own. As mock methods are promoted
// to real Auth0, no logout code has to change.
//
// When Auth0 is configured, logout() navigates here. The Auth0 nextjs-auth0 v4
// SDK mounts a GET /auth/logout route via proxy.ts that:
//   1. clears the encrypted, HTTP-only session cookie, then
//   2. redirects to Auth0's /v2/logout endpoint to end the IdP session, then
//   3. returns the user to `returnTo` (must be an Allowed Logout URL).
// This is the logout flow described in the Auth0 Next.js SDK docs.

export const AUTH0_LOGOUT_PATH = "/auth/logout"

/**
 * Build the URL for the SDK-mounted Auth0 logout route.
 *
 * By default no `returnTo` is sent: the SDK then defaults the post-logout
 * redirect to the app's base origin, which is what's registered as an Allowed
 * Logout URL on the Auth0 application (a relative path like "/" is NOT a valid
 * absolute logout URL and Auth0 would reject it). Only pass `returnTo` when you
 * have an absolute, registered URL to send the user to.
 *
 * @param returnTo Absolute, registered Allowed Logout URL to return to. Omit to
 *                 use the app origin (the common case).
 */
export function buildLogoutUrl(returnTo?: string): string {
  if (!returnTo) return AUTH0_LOGOUT_PATH
  const params = new URLSearchParams({ returnTo })
  return `${AUTH0_LOGOUT_PATH}?${params.toString()}`
}
