// CURRENT-BRAND DUPLICATE DETECTION — PURE
// ========================================
// A tiny framework-free rule the UK Create Account flow uses to answer ONE
// question deterministically and privacy-safely:
//
//   "Does THIS storefront brand's sign-in already exist for the submitted
//    email?"
//
// If it does, the drawer must guide the customer back to Sign in — never create
// a duplicate and never surface a generic server failure. This must hold even
// when the broader owning-account lookup is momentarily AMBIGUOUS (right after a
// cross-brand link the freshly created-then-linked secondary can transiently
// appear as a second candidate for the same email), so this check takes
// precedence over the fail-closed paths in the brand route.
//
// It is deliberately conservative: a match requires the SAME candidate account
// to BOTH own the submitted email AND hold a real database identity on the
// current brand's connection. A candidate that merely owns the email (but has no
// current-brand identity) or merely has a brand identity for a DIFFERENT email
// never matches — so this can neither invent a brand account nor leak anything
// beyond what an ordinary sign-in attempt already reveals for this exact address.
//
// NO "server-only" import → fully unit-testable without Auth0.

import { normalizeEmail, type LinkedDbIdentity } from "./credential-model.ts"

/** The two UK per-brand connection keys this detector is symmetric across. */
export type BrandConnectionKey = "dewalt" | "stanley"

/**
 * One candidate Auth0 account, reduced to the two trusted signals the rule
 * needs: the emails it genuinely OWNS (root / binding / verified alternate) and
 * its real linked database identities (mapped to connection keys). Ownership is
 * preserved per-candidate — a brand identity on account A can only satisfy an
 * email that account A also owns.
 */
export interface BrandDuplicateCandidate {
  ownedEmails: string[]
  identities: LinkedDbIdentity[]
}

/**
 * Whether the current storefront brand's sign-in already exists for `email`.
 * True iff SOME candidate account both owns the normalized email and holds a
 * real identity on `brandKey`'s connection. Symmetric for dewalt/stanley — only
 * the key differs.
 */
export function detectCurrentBrandCredential(params: {
  email: string
  brandKey: BrandConnectionKey
  candidates: BrandDuplicateCandidate[]
}): boolean {
  const normalized = normalizeEmail(params.email)
  if (!normalized) return false

  return params.candidates.some((candidate) => {
    const owns = candidate.ownedEmails.map(normalizeEmail).includes(normalized)
    if (!owns) return false
    return candidate.identities.some((id) => id.connectionKey === params.brandKey)
  })
}
