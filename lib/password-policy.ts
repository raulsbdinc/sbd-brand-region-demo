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

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/** Human-readable policy, shown as form helper text and reused in errors. */
export const PASSWORD_REQUIREMENTS_TEXT =
  "At least 8 characters, including at least 3 of: lowercase, uppercase, numbers, and special characters. Don't include part of your email address."

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
): PasswordPolicyResult {
  const pw = typeof password === "string" ? password : ""
  const failures: string[] = []
  if (pw.length < PASSWORD_MIN_LENGTH) failures.push(`At least ${PASSWORD_MIN_LENGTH} characters`)
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
