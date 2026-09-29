// SHARED REGISTRATION PASSWORD POLICY (pure, framework-free)
// ==========================================================
// Mirrors the UK custom DB connections' password policy so the browser and the
// server agree EXACTLY on what will be accepted — and a customer is never told
// "choose a stronger password" only AFTER we've already consumed their one-time
// code at the IdP (which mints a passwordless proof stub). Two rules a naive
// "length only" check misses, both enforced by the connection:
//
//   * strength ("good") — at least 8 characters AND at least 3 of the 4
//     character classes (lowercase, uppercase, digit, special).
//   * user-info — the password must not contain a recognisable part of the
//     email address (Auth0's PasswordNoUserInfoError). This is what rejected
//     "Ciam!2026UK1A" for sbdciam-uk1-2309@… : the email's local part contains
//     the token "uk1", which appears in the password. "good" strength alone
//     never predicts it, so the form couldn't warn — hence this shared check.
//
// Kept import-free so lib/model-registration (unit-tested under node:test) and
// the client registration form both validate identically.

// UK: the sbd-uk-temp1 DB connections (sbd-demo-per-email, sbd-demo-stanley,
// sbd-demo-dewalt) all enforce password_options.complexity.min_length = 15
// (read-only GET /api/v2/connections, 29 Sep). An 8-character password passed
// the old 8-char check, cost the customer an OTP, and was then rejected by
// Auth0. The 3-of-4 character-class and no-email-fragment rules are kept as
// app-side safeguards on top of Auth0's length rule. EU/FR/DE keep 8.
export const PASSWORD_MIN_LENGTH = 8
export const UK_PASSWORD_MIN_LENGTH = 15
export const PASSWORD_MAX_LENGTH = 128

/** Minimum password length for a market's database connections. */
export function passwordMinLength(market?: string): number {
  return market === "uk" ? UK_PASSWORD_MIN_LENGTH : PASSWORD_MIN_LENGTH
}

/** Human-readable policy for a market, shown as helper text and in errors. */
export function passwordRequirementsText(market?: string): string {
  return `At least ${passwordMinLength(market)} characters, including at least 3 of: lowercase, uppercase, numbers, and special characters. Don't include part of your email address.`
}

/** Default (EU/FR/DE) policy text. */
export const PASSWORD_REQUIREMENTS_TEXT = passwordRequirementsText()
/** UK policy text. */
export const UK_PASSWORD_REQUIREMENTS_TEXT = passwordRequirementsText("uk")

export interface PasswordPolicyResult {
  ok: boolean
  /** Each entry is a single unmet rule, safe to show to the customer. */
  failures: string[]
}

/**
 * Recognisable parts of an email that a password must not contain — the whole
 * local part plus its delimiter-split tokens, lowercased, each at least 3
 * characters. The domain is intentionally excluded to avoid false positives on
 * common providers (e.g. a password containing "gmail").
 */
export function emailUserInfoTokens(email: string): string[] {
  const e = typeof email === "string" ? email.trim().toLowerCase() : ""
  if (!e) return []
  const at = e.indexOf("@")
  const local = at >= 0 ? e.slice(0, at) : e
  const tokens = new Set<string>()
  const add = (s: string) => {
    if (s.length >= 3) tokens.add(s)
  }
  add(local)
  for (const part of local.split(/[^a-z0-9]+/)) add(part)
  return [...tokens]
}

/** Count how many of the four character classes are present. */
function characterClasses(pw: string): number {
  return (
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(pw) ? 1 : 0)
  )
}

/**
 * Validate a candidate registration password against the connection policy,
 * additionally rejecting any password that embeds a user-info token from one of
 * `emails`. Pure: the same call decides the form's submit-enable state, the
 * form's inline error, and the server's pre-consumption gate.
 */
export function validateRegistrationPassword(
  password: unknown,
  emails: string[] = [],
  market?: string,
): PasswordPolicyResult {
  const pw = typeof password === "string" ? password : ""
  const failures: string[] = []
  const min = passwordMinLength(market)
  if (pw.length < min) failures.push(`At least ${min} characters`)
  if (pw.length > PASSWORD_MAX_LENGTH) failures.push(`No more than ${PASSWORD_MAX_LENGTH} characters`)
  if (characterClasses(pw) < 3) {
    failures.push("At least 3 of: lowercase, uppercase, numbers, special characters")
  }
  if (pw) {
    const lower = pw.toLowerCase()
    const tokens = emails.flatMap(emailUserInfoTokens)
    if (tokens.some((t) => lower.includes(t))) {
      failures.push("Must not contain part of your email address")
    }
  }
  return { ok: failures.length === 0, failures }
}

/**
 * UK checklist rows for new-password forms (profile change, set brand
 * password, set second-email password) — the same rules as
 * validateRegistrationPassword(pw, emails, "uk"), one row per rule.
 */
export function ukPasswordChecklist(
  password: string,
  emails: string[] = [],
): { ok: boolean; text: string }[] {
  const pw = typeof password === "string" ? password : ""
  const lower = pw.toLowerCase()
  const tokens = emails.flatMap(emailUserInfoTokens)
  return [
    { ok: pw.length >= UK_PASSWORD_MIN_LENGTH, text: `At least ${UK_PASSWORD_MIN_LENGTH} characters` },
    { ok: characterClasses(pw) >= 3, text: "At least 3 of: lowercase, uppercase, numbers, special characters" },
    { ok: pw.length > 0 && !tokens.some((t) => lower.includes(t)), text: "Doesn't include part of your email address" },
  ]
}

/**
 * Checklist rows for a new-password form on this market: the UK connection
 * rules on UK, and the unchanged EU/FR/DE baseline everywhere else.
 */
export function newPasswordChecklist(
  password: string,
  market?: string,
  emails: string[] = [],
): { ok: boolean; text: string }[] {
  if (market === "uk") return ukPasswordChecklist(password, emails)
  const pw = typeof password === "string" ? password : ""
  return [
    { ok: pw.length >= PASSWORD_MIN_LENGTH, text: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw), text: "Upper and lowercase letters" },
    { ok: /[0-9]/.test(pw), text: "At least one number" },
  ]
}
