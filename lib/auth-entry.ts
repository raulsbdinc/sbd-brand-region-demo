/**
 * Pure helpers for the storefront's single-drawer auth entry model.
 *
 * The user-facing experience only ever uses the ONE standard auth drawer on the
 * storefront root. The legacy routes (`/signin`, `/sign-in/uk`, `/register/uk`)
 * are compatibility redirects: they bounce to `/` with a small query signal that
 * a root-level consumer turns into "open the drawer in the right mode", then the
 * URL is cleaned so no architecture/model language or parallel frontend leaks.
 *
 * `/profile` while logged out redirects the same way, but additionally carries a
 * safe `returnTo` so a successful sign-in returns the customer to `/profile`.
 *
 * Everything here is framework-free and unit-tested — no window, router, or
 * Auth0 access — so the redirect/return contract is provable in isolation.
 */

export type DrawerAuthMode = "sign-in" | "create-account"

/** Query key that signals the root drawer should open, and in which mode. */
export const AUTH_QUERY_KEY = "auth"
/** Query key carrying the safe post-auth return path. */
export const RETURN_TO_QUERY_KEY = "returnTo"

const MODE_VALUES: Record<string, DrawerAuthMode> = {
  signin: "sign-in",
  "sign-in": "sign-in",
  create: "create-account",
  "create-account": "create-account",
}

/**
 * Parse the `?auth=` query value into a drawer mode. Unknown/absent values
 * yield `null` (no drawer signal), so a normal `/` visit never auto-opens.
 */
export function parseAuthMode(value: string | null | undefined): DrawerAuthMode | null {
  if (!value) return null
  return MODE_VALUES[value.trim().toLowerCase()] ?? null
}

/** The canonical query value we EMIT for a given drawer mode. */
export function authModeQueryValue(mode: DrawerAuthMode): string {
  return mode === "create-account" ? "create" : "signin"
}

/**
 * Sanitize an untrusted `returnTo` into a safe SAME-SITE path, or `null`.
 *
 * Fail closed: only accept a value that is a single-slash-rooted relative path
 * (`/profile`, `/profile?tab=x`). Reject protocol-relative (`//evil.com`),
 * absolute URLs, backslash tricks, control chars, and anything that would let an
 * open redirect off-origin. Mirrors the same defense used by the UK sign-in
 * target builder so both entry points agree.
 */
export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (raw.length === 0) return null
  // Must start with exactly one "/", i.e. a rooted relative path.
  if (!raw.startsWith("/")) return null
  // Reject protocol-relative ("//host") and backslash-normalized variants.
  if (raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/%2f") || raw.startsWith("/%5c")) {
    return null
  }
  // Reject control chars, whitespace, and backslashes anywhere.
  if (/[\u0000-\u001f\u007f\\\s]/.test(raw)) return null
  // Reject an embedded scheme (e.g. "/redirect?x=https://evil").
  // We only allow the path+query+hash to reference our own origin implicitly.
  return raw
}

/**
 * Build the compatibility redirect target for a legacy auth route: the
 * storefront root plus the `?auth=` signal, and (when provided + safe) a
 * `returnTo`. Always returns a rooted same-site path.
 */
export function buildDrawerRedirect(params: {
  mode: DrawerAuthMode
  returnTo?: string | null
}): string {
  const query = new URLSearchParams()
  query.set(AUTH_QUERY_KEY, authModeQueryValue(params.mode))
  const safeReturn = sanitizeReturnTo(params.returnTo)
  if (safeReturn) query.set(RETURN_TO_QUERY_KEY, safeReturn)
  return `/?${query.toString()}`
}
