// Pure, dependency-free helper for the drawer's "Forgot password?" link.
// Kept in its own module (no imports) so it stays unit-testable under the
// node --test runner without pulling in the rest of auth-service.

// A permissive email-shape check, matching looksLikeEmail in auth-service.
// Duplicated deliberately to keep this module import-free.
function isEmailShaped(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// Build the target for the "Forgot password?" link. The typed email is carried
// as a query param ONLY when it's a valid address, so /recover can prefill
// without ever forwarding junk (and never leaks a half-typed string). The value
// is URL-encoded, so `+` and other reserved characters survive the round-trip.
export function recoveryHref(email: string): string {
  const trimmed = email.trim()
  return isEmailShaped(trimmed)
    ? `/recover?email=${encodeURIComponent(trimmed)}`
    : "/recover"
}

// The side effects the "Forgot password?" action needs. Passed in as callbacks
// so this stays pure/testable (no React, router, or DOM imports here).
export interface ForgotPasswordNavHandlers {
  /** Close the sign-in drawer (the parent flips its `open` state). */
  close: () => void
  /** Client-side navigate to the recovery route, preserving the query. */
  navigate: (href: string) => void
}

// Orchestrate the "Forgot password?" action. It CLOSES the drawer first, then
// navigates to the recovery page for the typed email — so the drawer can never
// stay mounted on top of and block the recovery page. It only ever closes +
// navigates; it has no way to submit a recovery request (there is no submit
// dependency), so switching to recovery never fires a network call. Returns the
// href it navigated to, which is useful for tests.
export function runForgotPasswordNavigation(
  email: string,
  handlers: ForgotPasswordNavHandlers,
): string {
  const href = recoveryHref(email)
  // Close BEFORE navigating so the drawer tears down as the route changes.
  handlers.close()
  handlers.navigate(href)
  return href
}
