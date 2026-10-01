// EU BRAND SESSION GATE — PURE
// ============================
// On the EU (FR/DE) storefronts the Auth0 SDK writes its __session cookie at
// /auth/callback BEFORE /api/signin/google/reconcile has checked that the
// account is enrolled in this storefront's brand. Without a server gate that
// cookie alone would open /profile, /auth/profile and protected APIs for an
// unenrolled brand. So every SDK-callback session on an EU storefront is marked
// PENDING (see brandSessionUser) and the proxy enforces decideBrandSessionGate
// until the reconcile route verifies the real linked identities and clears the
// mark. Sessions minted by our own password/passcode routes are created only
// after their own server-side brand check and never carry the mark.

import { brandAccessEnforced } from "./brand-access.ts"

export const BRAND_PENDING_CLAIM = "sbd_brand_pending"

export const BRAND_RECONCILE_PATH = "/api/signin/google/reconcile"

/** Paths a PENDING session may still reach: the reconcile/proof journey and
 *  the SDK's own login/logout/callback plumbing. Everything else is gated. */
const PENDING_ALLOWED_PREFIXES = [
  BRAND_RECONCILE_PATH,
  "/link-google",
  "/auth/login",
  "/auth/logout",
  "/auth/callback",
  "/auth-error",
]

export type BrandSessionGateDecision =
  | { action: "allow" }
  /** Page navigation: send the visitor through server reconciliation. */
  | { action: "redirect"; location: string }
  /** /api/me: answer as anonymous (200, user:null) — never expose the user. */
  | { action: "anonymous" }
  /** Any other protected endpoint (incl. /auth/profile, /auth/access-token). */
  | { action: "deny" }

/** Whether a session user object is still awaiting brand verification. */
export function isBrandPending(user: Record<string, unknown> | null | undefined): boolean {
  return user?.[BRAND_PENDING_CLAIM] === true
}

/** Mark an SDK-callback session user as pending on brand-enforcing markets. */
export function brandSessionUser<T extends Record<string, unknown>>(
  user: T,
  market: string,
): T {
  if (!brandAccessEnforced(market)) return user
  return { ...user, [BRAND_PENDING_CLAIM]: true }
}

/** Remove the pending mark once the reconcile route has authorized the brand. */
export function clearBrandPending<T extends Record<string, unknown>>(user: T): T {
  const { [BRAND_PENDING_CLAIM]: _pending, ...rest } = user
  return rest as T
}

function isAllowedWhilePending(pathname: string): boolean {
  return PENDING_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

/** Static files (images, fonts, …) carry no session data. */
function isStaticAsset(pathname: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(pathname) && !pathname.startsWith("/api/")
}

export function decideBrandSessionGate(input: {
  market: string
  user: Record<string, unknown> | null | undefined
  pathname: string
}): BrandSessionGateDecision {
  const { market, user, pathname } = input
  if (!brandAccessEnforced(market)) return { action: "allow" }
  if (!isBrandPending(user)) return { action: "allow" }
  if (isAllowedWhilePending(pathname) || isStaticAsset(pathname)) {
    return { action: "allow" }
  }
  if (pathname === "/api/me") return { action: "anonymous" }
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    return { action: "deny" }
  }
  return { action: "redirect", location: BRAND_RECONCILE_PATH }
}
