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
