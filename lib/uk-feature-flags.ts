// UK storefront feature flags (DeWalt UK / Stanley UK only).
//
// CIAM standup 2026-09-30: the active UK demo runs ONE account setup — a
// separate password for each brand, on one canonical customer identity, with
// ownership proof before a second brand is added. The older "a password for
// each email" setup stays in the codebase but is hidden behind
// NEXT_PUBLIC_UK_PER_EMAIL_ACCOUNTS, which is OFF unless explicitly set.
//
// The flag only ever narrows the UK experience. Off the UK market the per-email
// setup was never offered, so EU (fr/de) behaviour is identical either way.
//
// `process.env.NEXT_PUBLIC_UK_PER_EMAIL_ACCOUNTS` is written out literally so
// Next.js inlines it into client bundles; server routes read the same value.

import type { CountryId } from "./types.ts"

const TRUE_VALUES = new Set(["1", "true", "on", "yes"])

/** Parse the raw flag value. Anything other than an explicit "on" is OFF. */
export function parseFlag(raw: string | undefined | null): boolean {
  if (typeof raw !== "string") return false
  return TRUE_VALUES.has(raw.trim().toLowerCase())
}

/** The deployment's raw per-email flag (default OFF). */
export const UK_PER_EMAIL_ACCOUNTS_FLAG: boolean = parseFlag(
  process.env.NEXT_PUBLIC_UK_PER_EMAIL_ACCOUNTS,
)

/**
 * Whether the "password for each email" setup may be offered on this market.
 * True only on the UK market AND with the flag explicitly on.
 */
export function perEmailAccountsEnabled(
  market: CountryId,
  flag: boolean = UK_PER_EMAIL_ACCOUNTS_FLAG,
): boolean {
  return market === "uk" && flag
}

/** Neutral refusal for a per-email endpoint while the setup is switched off. */
export const PER_EMAIL_UNAVAILABLE_MESSAGE =
  "That option isn't available here. Create an account with a password for this brand instead."

/**
 * Guidance for a customer whose EXISTING account uses the older per-email
 * setup. Their account is never converted or merged; their current passwords
 * keep working for sign-in and "Forgot password".
 */
export const LEGACY_PER_EMAIL_ACCOUNT_MESSAGE =
  "This email already has an account with an earlier sign-in setup. Sign in with your existing password, or use \u201CForgot password\u201D to reset it. Nothing has been changed."

export const LEGACY_PER_EMAIL_PROFILE_LINE =
  "Your account uses an earlier sign-in setup. Your existing passwords still work \u2014 use \u201CForgot password\u201D on the sign-in screen to reset one."
