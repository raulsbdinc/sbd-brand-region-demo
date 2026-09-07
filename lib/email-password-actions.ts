// PER-EMAIL PASSWORD ACTIONS — PURE, BESIDE-EACH-EMAIL PLANNER
// ============================================================
// GLSCM-4834: the per-email "separate password" control used to live buried in
// the "How you sign in" credentials list, where customers (Sat) couldn't find
// it. This pure planner decides, for EACH verified email row in the profile's
// "Email addresses" section, which single address-specific action to show:
//
//   • "set-separate" — this alternate email has no password of its own yet, so
//     offer "Set separate password" (opens the existing per-email activation).
//   • "change"       — this email already has its OWN per-email password, so
//     offer "Change password" (opens the existing inline change dialog).
//   • "none"         — no beside-email action (e.g. the primary before any
//     per-email password exists, or a Google-only address).
//
// It is FRAMEWORK-FREE (no "server-only", no React) so every rule is unit
// testable without Auth0 or the DOM. The route + resolver remain the real trust
// boundary; this only decides which control a row renders.
//
// UK-ONLY: per-email passwords (Model 3) are a UK experience. On EU Models 1/2
// the account has ONE shared Account password and its linked alternates sign in
// with that same shared password — so `perEmailActivationAvailable` (resolved
// server-side from SITE_MARKET) gates every action to "none" off the UK
// storefront. Model 4 (per-brand) passwords are managed as brand credentials in
// the sign-in list and are never turned into per-email rows here.

import { normalizeEmail } from "./credential-model.ts"

export type EmailPasswordActionKind = "set-separate" | "change" | "none"

export interface PlanEmailPasswordActionInput {
  /** The email of the row being decided. */
  email: string
  /** The account's primary/root email. */
  primaryEmail: string | null
  /** UK Model 3 gate, resolved server-side from SITE_MARKET. */
  perEmailActivationAvailable: boolean
  /** All verified, owned emails on the account (account + alternates + Google). */
  verifiedEmails: string[]
  /** Emails that already have their OWN per-email password (from login-methods). */
  backedPerEmailEmails: string[]
}

/**
 * Decide the single beside-email password action for one verified email row.
 *
 * Rules (fail CLOSED to "none"):
 *   • Off the Model-3 (UK) experience → always "none".
 *   • The email must be a verified, owned account email.
 *   • Already has its own per-email password → "change" (works for the primary
 *     too, once the pair is activated — checked BEFORE the primary rule so an
 *     activated primary still offers a change).
 *   • Otherwise a verified ALTERNATE (not the primary) → "set-separate".
 *   • The primary email with no per-email password of its own → "none" (Model 3
 *     activation is always initiated from an alternate, which provisions the
 *     primary's per-email identity alongside it).
 */
export function planEmailPasswordAction(
  input: PlanEmailPasswordActionInput,
): EmailPasswordActionKind {
  if (!input.perEmailActivationAvailable) return "none"

  const email = normalizeEmail(input.email)
  if (!email) return "none"

  const verified = new Set(input.verifiedEmails.map(normalizeEmail).filter(Boolean))
  if (!verified.has(email)) return "none"

  const backed = new Set(input.backedPerEmailEmails.map(normalizeEmail).filter(Boolean))
  if (backed.has(email)) return "change"

  const primary = normalizeEmail(input.primaryEmail ?? "")
  if (email === primary) return "none"

  return "set-separate"
}

/** The exact button label for a beside-email action ("" for "none"). */
export function emailPasswordActionLabel(kind: EmailPasswordActionKind): string {
  switch (kind) {
    case "set-separate":
      return "Set separate password"
    case "change":
      return "Change password"
    default:
      return ""
  }
}

/**
 * The exact accessible name for a beside-email action, always naming the exact
 * email. The compact VISIBLE label may stay "Change password" because the email
 * is directly adjacent, but the aria-label must disambiguate for screen readers
 * (GLSCM-4834): e.g. "Change password for fatrazigna@necub.com".
 */
export function emailPasswordActionAriaLabel(
  kind: EmailPasswordActionKind,
  email: string,
): string {
  const label = emailPasswordActionLabel(kind)
  if (!label) return ""
  return `${label} for ${email}`
}

export interface PerEmailPasswordControl {
  /** The exact email the control targets (as displayed, not normalized). */
  email: string
  /** The single actionable kind for this row (never "none"). */
  kind: Exclude<EmailPasswordActionKind, "none">
  /** Compact visible label ("Change password" / "Set separate password"). */
  label: string
  /** Accessible name, always naming the exact email. */
  ariaLabel: string
}

/**
 * Aggregate the beside-email password controls across every verified email —
 * exactly the actionable rows the "Email addresses" section renders. Model 3
 * (UK) is single-source: this is the ONLY place a per-email password action is
 * offered, so the "How you sign in" list must not repeat them. Off Model 3 (EU)
 * every row is "none" and this returns [].
 */
export function planPerEmailPasswordControls(input: {
  primaryEmail: string | null
  perEmailActivationAvailable: boolean
  verifiedEmails: string[]
  backedPerEmailEmails: string[]
}): PerEmailPasswordControl[] {
  const controls: PerEmailPasswordControl[] = []
  for (const email of input.verifiedEmails) {
    const kind = planEmailPasswordAction({
      email,
      primaryEmail: input.primaryEmail,
      perEmailActivationAvailable: input.perEmailActivationAvailable,
      verifiedEmails: input.verifiedEmails,
      backedPerEmailEmails: input.backedPerEmailEmails,
    })
    if (kind === "none") continue
    controls.push({
      email,
      kind,
      label: emailPasswordActionLabel(kind),
      ariaLabel: emailPasswordActionAriaLabel(kind, email),
    })
  }
  return controls
}

/**
 * After a NEW alternate email is verified in /profile, decide whether to show
 * the immediate "give this email its own password" next step for that exact
 * address. True only on the UK Model-3 experience for a genuine alternate (a
 * freshly verified address is, by definition, not the primary and has no
 * per-email password yet). EU/Model-1/2 never offers it.
 */
export function shouldOfferPostVerificationPassword(input: {
  perEmailActivationAvailable: boolean
  verifiedEmail: string
  primaryEmail: string | null
}): boolean {
  if (!input.perEmailActivationAvailable) return false
  const email = normalizeEmail(input.verifiedEmail)
  if (!email) return false
  const primary = normalizeEmail(input.primaryEmail ?? "")
  if (email === primary) return false
  return true
}
