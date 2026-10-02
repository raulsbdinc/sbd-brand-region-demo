// SHARED PASSWORD POLICY (pure, framework-free)
// =============================================
// ONE rule for every storefront (DeWalt FR, DeWalt DE, Stanley FR, DeWalt UK,
// Stanley UK) and every password-creating or password-changing path (signup,
// second-brand enrollment, recovery/reset, account-page change):
//
//   * at least 8 characters
//   * at least one lowercase letter (a-z)
//   * at least one uppercase letter (A-Z)
//   * at least one special character (ASCII punctuation or space)
//   * numbers are optional
//   * at most 72 bytes (Auth0's bcrypt input limit; rejected, never truncated)
//
// Nothing else: no email/name/personal-content rule, no dictionary, no
// three-of-four classes, no sequential/identical-character rule, no trimming.
//
// The four Auth0 brand connections carry the SAME rule natively through the
// Flexible Password Policy (password_options.complexity: min_length 8,
// character_types [lowercase, uppercase, special], character_type_rule "all",
// max_length_exceeded "error"; profile_data and dictionary inactive), set by
// scripts/auth0-migration/set-password-policy.mjs. The app validates first so
// the form and every API route refuse a bad password before any one-time code
// is consumed; Auth0 is the second, independent enforcement layer.
//
// Character sets match Auth0's password-sheriff definitions so the app never
// accepts something the provider would refuse. Other characters (accents,
// emoji, digits) are always allowed; they just don't count as a required class.
//
// Login never calls this module: existing customers keep signing in with the
// passwords they already have.

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_BYTES = 72

// Kept as aliases so existing imports keep compiling; the rule is identical.
export const UK_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH
export const EU_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH
export const EU_PASSWORD_MAX_BYTES = PASSWORD_MAX_BYTES

const LOWERCASE = /[a-z]/
const UPPERCASE = /[A-Z]/
const SPECIAL = /[ !"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

export interface PasswordRule {
  id: "length" | "lowercase" | "uppercase" | "special" | "max-bytes"
  /** Customer-safe description of the rule. */
  text: string
  test: (password: string) => boolean
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", text: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { id: "lowercase", text: "At least one lowercase letter", test: (p) => LOWERCASE.test(p) },
  { id: "uppercase", text: "At least one uppercase letter", test: (p) => UPPERCASE.test(p) },
  { id: "special", text: "At least one special character, such as ! @ # ? or %", test: (p) => SPECIAL.test(p) },
  {
    id: "max-bytes",
    text: `No longer than ${PASSWORD_MAX_BYTES} bytes`,
    test: (p) => utf8ByteLength(p) <= PASSWORD_MAX_BYTES,
  },
]

/** The same text everywhere, shown as helper text and in errors. */
export const PASSWORD_REQUIREMENTS_TEXT = `At least ${PASSWORD_MIN_LENGTH} characters, with at least one uppercase letter, one lowercase letter and one special character (such as ! @ # ? or %). Numbers are optional.`
export const UK_PASSWORD_REQUIREMENTS_TEXT = PASSWORD_REQUIREMENTS_TEXT

/** Minimum length. The market argument is accepted for compatibility only. */
export function passwordMinLength(_market?: string): number {
  return PASSWORD_MIN_LENGTH
}

/** Requirements text. Identical on every market. */
export function passwordRequirementsText(_market?: string): string {
  return PASSWORD_REQUIREMENTS_TEXT
}

export interface PasswordPolicyResult {
  ok: boolean
  /** Each entry is a single unmet rule, safe to show to the customer. */
  failures: string[]
}

/** Validate a new password against the single shared rule. */
export function validatePassword(password: unknown): PasswordPolicyResult {
  const pw = typeof password === "string" ? password : ""
  const failures = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.text)
  return { ok: failures.length === 0, failures }
}

/**
 * Compatibility entry point used by registration, enrollment and account
 * routes. Emails and market are ignored on purpose: the rule is the same
 * everywhere and never blocks email or name substrings.
 */
export function validateRegistrationPassword(
  password: unknown,
  _emails: string[] = [],
  _market?: string,
): PasswordPolicyResult {
  return validatePassword(password)
}

/**
 * Checklist rows for a new-password field. The byte-limit row only appears
 * once it is actually exceeded, so normal guidance stays to four rows.
 */
export function newPasswordChecklist(
  password: string,
  _market?: string,
  _emails: string[] = [],
): { ok: boolean; text: string }[] {
  const pw = typeof password === "string" ? password : ""
  return PASSWORD_RULES.filter((r) => r.id !== "max-bytes" || !r.test(pw)).map((r) => ({
    ok: pw.length > 0 && r.test(pw),
    text: r.text,
  }))
}

/** Alias kept for existing UK callers; same rows as newPasswordChecklist. */
export function ukPasswordChecklist(password: string, emails: string[] = []): { ok: boolean; text: string }[] {
  return newPasswordChecklist(password, "uk", emails)
}
