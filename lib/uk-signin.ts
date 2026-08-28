// UK SIGN-IN — USER-FACING OPTION → CONNECTION SELECTION (PURE)
// =============================================================
// The UK storefront supports FOUR ways an account might have been set up, each
// backed by a DIFFERENT Auth0 connection (see lib/credential-model.ts). The
// generic "Sign in" link (bare /auth/login) always lands on the tenant's
// DEFAULT connection (the shared `sbd-eu`), so a per-email (Model 3) or
// per-brand (Model 4) user is sent to the wrong connection and gets "Wrong
// email or password" even though their credential is perfectly valid.
//
// The fix routes UK sign-in through an explicit chooser: the customer says how
// their account was set up (in plain language, never an Auth0 connection name)
// and we start /auth/login pinned to the matching connection + login_hint. We
// deliberately DO NOT infer a connection from the email address — the same
// email may legitimately exist in more than one model (e.g. a shared account
// AND a brand password), so only the customer's own choice disambiguates it.
//
// This module is FRAMEWORK-FREE and holds only the pure option → connection-key
// mapping and the /auth/login URL construction. It NEVER reads a raw connection
// NAME from the browser: the option ids below are the only identifiers that
// cross to the client; the real connection names are injected server-side (from
// resolveConnectionNames) into buildUkSignInTarget and never returned to it.

import type { BrandId } from "./types"
import { type ConnectionKey, isBrandAllowed } from "./credential-model.ts"

// --- User-facing options ----------------------------------------------------
// These ids are safe to expose to the browser; they are NOT connection names.
export type UkSignInOptionId = "shared" | "per-email" | "brand" | "google"

export const UK_SIGNIN_OPTION_IDS: readonly UkSignInOptionId[] = [
  "shared",
  "per-email",
  "brand",
  "google",
] as const

const UK_SIGNIN_OPTION_SET: ReadonlySet<UkSignInOptionId> = new Set(
  UK_SIGNIN_OPTION_IDS,
)

/** Whether a value is one of the allow-listed UK sign-in option ids. */
export function isUkSignInOptionId(value: unknown): value is UkSignInOptionId {
  return (
    typeof value === "string" &&
    UK_SIGNIN_OPTION_SET.has(value as UkSignInOptionId)
  )
}

export interface UkSignInOption {
  id: UkSignInOptionId
  /** Plain-language label — describes HOW the account was set up, never a
   * connection name. */
  label: string
  /** One-line helper describing who this option fits. */
  description: string
  /**
   * Password options collect the email first (used as the `login_hint`);
   * Google needs no email because the IdP owns the identifier.
   */
  needsEmail: boolean
}

/**
 * The ordered UK sign-in options, with the current storefront brand name woven
 * into the brand-password option. Pure: the brand NAME is passed in so this can
 * be unit-checked without any deployment env.
 */
export function ukSignInOptions(brandName: string): UkSignInOption[] {
  return [
    {
      id: "shared",
      label: "My existing shared account",
      description:
        "You use one email and password across our brands and regions.",
      needsEmail: true,
    },
    {
      id: "per-email",
      label: "A different email and password",
      description:
        "You set up a separate email and its own password just for signing in.",
      needsEmail: true,
    },
    {
      id: "brand",
      label: `A separate password for ${brandName}`,
      description: `You kept one email but created a ${brandName}-only password.`,
      needsEmail: true,
    },
    {
      id: "google",
      label: "Google",
      description: "Continue with your Google account.",
      needsEmail: false,
    },
  ]
}

// --- Option → connection key ------------------------------------------------

/**
 * Map a chosen option + the storefront brand to exactly one allow-listed
 * connection key, or `null` for Google (a social connection handled separately)
 * and for a brand option on a storefront that has no brand connection key
 * (only `dewalt`/`stanley` are brand keys).
 */
export function ukOptionConnectionKey(
  id: UkSignInOptionId,
  brand: BrandId,
): ConnectionKey | null {
  switch (id) {
    case "shared":
      return "shared"
    case "per-email":
      return "per-email"
    case "brand":
      if (brand === "dewalt") return "dewalt"
      if (brand === "stanley") return "stanley"
      return null
    case "google":
      return null
  }
}

// --- returnTo safety --------------------------------------------------------

/**
 * Constrain a `returnTo` to a same-origin, in-app path. Rejects absolute URLs,
 * protocol-relative (`//host`) and backslash (`/\host`) tricks that browsers
 * treat as cross-origin, falling back to a safe default.
 */
export function safeReturnTo(
  raw: string | null | undefined,
  fallback = "/profile",
): string {
  if (typeof raw !== "string") return fallback
  const v = raw.trim()
  if (!v.startsWith("/")) return fallback
  if (v.startsWith("//") || v.startsWith("/\\")) return fallback
  return v
}

// --- Target URL construction ------------------------------------------------

/** Minimal email sanity check (server enforces the real policy at Auth0). */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export interface UkSignInTargetInput {
  optionId: UkSignInOptionId
  /** Required for password options; ignored for Google. */
  email?: string | null
  returnTo?: string | null
  brand: BrandId
  /** Server-resolved connection NAMES per key (from resolveConnectionNames). */
  names: Record<ConnectionKey, string | undefined>
}

export type UkSignInTargetReason =
  | "invalid-option"
  | "brand-not-allowed"
  | "missing-email"
  | "not-configured"

export type UkSignInTarget =
  | { ok: true; url: string }
  | { ok: false; reason: UkSignInTargetReason }

/**
 * Build the /auth/login URL for a chosen option, pinned to the correct
 * connection so a per-email / per-brand credential is no longer misrouted to
 * the shared default. Pure — the connection names are injected, never read from
 * env here — so the whole selection matrix is unit-testable.
 *
 * Google preserves the existing cold-login reconciliation: `prompt=login`
 * re-challenges on every brand and a verified-email Google sign-in is linked to
 * any existing password account server-side by an Auth0 Action.
 */
export function buildUkSignInTarget(input: UkSignInTargetInput): UkSignInTarget {
  const returnTo = safeReturnTo(input.returnTo)

  if (input.optionId === "google") {
    const params = new URLSearchParams({
      connection: "google-oauth2",
      prompt: "login",
      returnTo,
    })
    return { ok: true, url: `/auth/login?${params.toString()}` }
  }

  const key = ukOptionConnectionKey(input.optionId, input.brand)
  if (!key) return { ok: false, reason: "invalid-option" }
  if (!isBrandAllowed(key, input.brand)) {
    return { ok: false, reason: "brand-not-allowed" }
  }

  const email = input.email?.trim() ?? ""
  if (!email || !looksLikeEmail(email)) {
    return { ok: false, reason: "missing-email" }
  }

  const connectionName = input.names[key]
  if (!connectionName) return { ok: false, reason: "not-configured" }

  // `prompt=login` forces Auth0 to actually request the chosen credential even
  // when a tenant SSO session already exists. Without it, a leftover session
  // (e.g. a previous shared-account sign-in) is silently returned and the
  // customer's explicit choice of email/connection is bypassed — the reported
  // defect where picking "A different email and password" logged the wrong
  // (previous) user straight back in. Google already sets this in its branch.
  const params = new URLSearchParams({
    connection: connectionName,
    login_hint: email,
    prompt: "login",
    returnTo,
  })
  return { ok: true, url: `/auth/login?${params.toString()}` }
}

/** Friendly, non-revealing copy for each failed-target reason. */
export const UK_SIGNIN_ERROR_COPY: Record<UkSignInTargetReason, string> = {
  "invalid-option": "Please choose how your account was set up.",
  "brand-not-allowed":
    "That option isn't available on this storefront. Please choose another.",
  "missing-email": "Enter the email address for this account first.",
  "not-configured":
    "That sign-in option isn't enabled for this storefront yet.",
}
