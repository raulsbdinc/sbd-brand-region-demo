// ADD-EMAIL CANONICAL OWNERSHIP GUARD — PURE
// ==========================================
// When an authenticated customer adds ANOTHER email address to their account
// (Model 3 completion / "Add another email"), the address they type may already
// belong to a DIFFERENT canonical customer. Linking it anyway would silently
// attach a second person's mailbox to this account. This module is the pure,
// framework-free decision for whether an ownership-proven add may proceed.
//
// The rule (fail CLOSED):
//   • Resolve EVERY account that provably owns the normalized email, each mapped
//     to its CANONICAL parent user id (a linked identity resolves to the primary
//     it is linked under — never to itself).
//   • ALLOW only when every existing owner resolves to the CURRENT canonical
//     user (i.e. the email is unowned, or already owned by this same account —
//     the Model 4 cross-brand / partial-retry case).
//   • REJECT when any owner is a different canonical customer ("different-owner")
//     or when ownership cannot be determined ("ambiguous"/"unavailable").
//
// This runs AFTER the emailed one-time code has proven mailbox control, so it is
// never an enumeration oracle: a customer only reaches it for an address they
// just demonstrated they can receive mail at. It intentionally makes NO Auth0
// calls itself — the server bridge supplies the already-resolved owner set.

import { normalizeEmail } from "./credential-model.ts"

/**
 * One provable owner of the submitted email, already reduced by the caller to
 * its CANONICAL parent account id. For a standalone account this is its own
 * `user_id`; for a linked identity it is the primary `user_id` it is linked
 * under. The caller is responsible for the canonical mapping — this pure core
 * only compares canonical ids.
 */
export interface CanonicalOwner {
  /** The canonical (primary) Auth0 user id that ultimately owns this email. */
  canonicalUserId: string
}

export type AddEmailOwnershipDecision =
  | { ok: true }
  | { ok: false; reason: "different-owner" | "ambiguous" | "unavailable" }

/**
 * Decide whether `currentUserId` may add `email`, given the fully-resolved set
 * of canonical owners and whether that resolution is trustworthy/complete.
 *
 *   • `lookupOk === false` → a directory lookup failed; absence of a foreign
 *     owner cannot be proven, so fail closed as "unavailable".
 *   • no owners            → unowned, ALLOW.
 *   • all owners are the current canonical user → ALLOW (same-account
 *     Model 4 cross-brand / idempotent retry).
 *   • any owner is a different canonical user → REJECT "different-owner".
 *   • the current user is among the owners but so is someone else, OR the owner
 *     set is otherwise not uniquely this account → REJECT (ambiguous/different).
 */
export function evaluateAddEmailOwnership(params: {
  email: string
  currentUserId: string
  owners: CanonicalOwner[]
  lookupOk: boolean
}): AddEmailOwnershipDecision {
  const normalized = normalizeEmail(params.email)
  if (!normalized) return { ok: false, reason: "unavailable" }
  if (!params.currentUserId) return { ok: false, reason: "unavailable" }
  if (!params.lookupOk) return { ok: false, reason: "unavailable" }

  const distinct = new Set<string>()
  for (const owner of params.owners) {
    const id = owner.canonicalUserId?.trim()
    if (!id) {
      // An owner we could not map to a canonical parent means we cannot prove
      // it is this account — fail closed rather than guess.
      return { ok: false, reason: "ambiguous" }
    }
    distinct.add(id)
  }

  if (distinct.size === 0) return { ok: true }
  if (distinct.size === 1 && distinct.has(params.currentUserId)) return { ok: true }
  // Every remaining shape includes at least one foreign canonical owner.
  return { ok: false, reason: "different-owner" }
}

/** Neutral, customer-safe copy for a rejected add. */
export function addEmailRejectionCopy(
  reason: "different-owner" | "ambiguous" | "unavailable",
): string {
  switch (reason) {
    case "different-owner":
      return "This email is already used by another account and cannot be added here."
    case "ambiguous":
      return "This email is already used by another account and cannot be added here."
    case "unavailable":
      return "We couldn't verify that email right now. Please try again."
  }
}
