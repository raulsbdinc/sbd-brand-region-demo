// PER-EMAIL PAIR ACTIVATION — PURE PLANNER
// ========================================
// Decides, from a signed-in account's server-PROVEN state, exactly which
// per-email database identities a Model 3 activation must create so the account
// ends with a COMPLETE per-email set (two or more independently passworded
// emails, each its own identity on the per-email connection, all linked to the
// one canonical customer).
//
// The rejected "single secondary row" shape (one per-brand primary + one
// per-email secondary) is NOT Model 3. Activating from the reproduced state —
// primary email A carries a per-brand (or shared) credential, alternate email B
// is only an OTP-verified passwordless alias — must provision BOTH:
//   • a per-email identity for A (using A's already-verified current password), and
//   • a per-email identity for B (using the new password entered for B),
// then link both and record two distinct per-email bindings.
//
// This module is FRAMEWORK-FREE (no "server-only") so every rule is unit
// testable without Auth0. The route (app/api/account/passwords/activate) proves
// ownership, performs the Management writes with rollback/idempotency, and
// re-derives everything here from a freshly re-read primary user.

import {
  normalizeEmail,
  type ConnectionKey,
  type CredentialBinding,
} from "./credential-model.ts"

/**
 * The server-PROVEN state a per-email activation is planned against. The route
 * builds this ONLY after re-reading the primary Auth0 user, so the pure planner
 * trusts these fields as already validated (ownership + verification).
 */
export interface PerEmailActivationContext {
  /** The account's primary/root email (normalized upstream or here). */
  primaryEmail: string
  /** The alternate email the customer clicked "Add password" on. */
  secondaryEmail: string
  /** Verified, owned emails on the primary account (proven server-side). */
  verifiedEmails: string[]
  /** Existing coherent bindings on the primary account. */
  existingBindings: CredentialBinding[]
  /**
   * Emails that already have a BACKED per-email credential on this account
   * (binding + real linked identity). Used for idempotent partial-retry: an
   * email already in this set is never re-created.
   */
  backedPerEmailEmails: string[]
  /** Connection keys that have a configured connection name. */
  configuredKeys: ReadonlySet<ConnectionKey>
}

export type PerEmailActivationRejectReason =
  | "not-configured" // the per-email connection is not configured
  | "secondary-not-eligible" // B missing / not a verified alternate / already scoped elsewhere
  | "primary-not-eligible" // A missing or not a verified owned email
  | "same-email" // B equals A — not a second identity

export type PerEmailActivationPlan =
  | {
      ok: true
      primaryEmail: string
      secondaryEmail: string
      /** Create a per-email identity for the primary email A (with its current password). */
      createPrimary: boolean
      /** Create a per-email identity for the secondary email B (with the new password). */
      createSecondary: boolean
      /**
       * True when BOTH emails already have backed per-email credentials, so the
       * account is already a complete per-email pair — the route only needs to
       * ensure the activation marker and return success (idempotent no-op).
       */
      alreadyActivated: boolean
    }
  | { ok: false; reason: PerEmailActivationRejectReason }

/** Scoped (non-shared) bindings for an email, by connection key. */
function scopedBindingsForEmail(
  bindings: CredentialBinding[],
  email: string,
): CredentialBinding[] {
  return bindings.filter(
    (b) => b.connectionKey !== "shared" && normalizeEmail(b.email) === email,
  )
}

/**
 * Plan the per-email PAIR activation for turning primary email A + alternate
 * email B into a complete Model 3 per-email set on ONE canonical account.
 *
 * Rules (all fail CLOSED with a neutral reason):
 *   • The per-email connection must be configured.
 *   • A and B must both be verified, owned emails, and must differ.
 *   • B must be a genuine ALTERNATE (not the primary) and must not already carry
 *     a per-brand credential (that would collide with a new per-email one).
 *   • A MAY already carry a per-brand (or shared) credential — that is exactly
 *     the reproduced state; the per-email credential we add for A becomes
 *     authoritative once the pair is complete (resolver precedence), and the
 *     per-brand row is preserved as coexisting Model 4 data.
 *   • An email that already has a BACKED per-email credential is not re-created
 *     (idempotent partial-retry); when both already do, the plan is a no-op.
 */
export function planPerEmailActivation(
  context: PerEmailActivationContext,
): PerEmailActivationPlan {
  if (!context.configuredKeys.has("per-email")) {
    return { ok: false, reason: "not-configured" }
  }

  const primary = normalizeEmail(context.primaryEmail)
  const secondary = normalizeEmail(context.secondaryEmail)
  const verified = new Set(
    context.verifiedEmails.map(normalizeEmail).filter(Boolean),
  )
  const backed = new Set(context.backedPerEmailEmails.map(normalizeEmail).filter(Boolean))

  if (!primary || !verified.has(primary)) {
    return { ok: false, reason: "primary-not-eligible" }
  }
  if (!secondary || !verified.has(secondary)) {
    return { ok: false, reason: "secondary-not-eligible" }
  }
  if (secondary === primary) {
    return { ok: false, reason: "same-email" }
  }

  // B must not already hold a NON-per-email scoped credential (a brand password
  // on the alternate address) — a new per-email credential would then match on
  // that brand's sites alongside it → unresolvable. A per-email credential for B
  // is fine (idempotent skip below).
  const secondaryScoped = scopedBindingsForEmail(context.existingBindings, secondary)
  if (secondaryScoped.some((b) => b.connectionKey !== "per-email")) {
    return { ok: false, reason: "secondary-not-eligible" }
  }

  const createPrimary = !backed.has(primary)
  const createSecondary = !backed.has(secondary)

  return {
    ok: true,
    primaryEmail: primary,
    secondaryEmail: secondary,
    createPrimary,
    createSecondary,
    alreadyActivated: !createPrimary && !createSecondary,
  }
}

/**
 * PURE UI helper: from the verified emails and the emails that already have a
 * backed per-email credential, list the alternate emails that are ELIGIBLE for
 * an "Add password" activation on THIS account.
 *
 * An alternate is eligible when it is verified/owned, is not the primary, and
 * does not already have its own per-email password. This does not itself gate
 * on configuration or on the primary — the route's planner is the real gate and
 * fails closed; this only drives which email rows show the action.
 */
export function eligibleActivationEmails(input: {
  primaryEmail: string
  verifiedEmails: string[]
  backedPerEmailEmails: string[]
}): string[] {
  const primary = normalizeEmail(input.primaryEmail)
  const backed = new Set(input.backedPerEmailEmails.map(normalizeEmail).filter(Boolean))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.verifiedEmails) {
    const email = normalizeEmail(raw)
    if (!email || email === primary) continue
    if (backed.has(email)) continue
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}
