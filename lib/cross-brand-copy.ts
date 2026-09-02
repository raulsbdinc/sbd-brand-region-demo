// CROSS-BRAND RECOGNITION COPY — PURE
// ===================================
// The welcome banner names the sites an account has already used and states
// the account's password topology in customer language. The exact wording
// depends on the account's REAL credential model (derived server-side from its
// bindings), never on an assumption:
//
//   - shared password (EU Models 1 & 2): one account, one password, one record
//   - per-brand (UK Model 4): one customer record, SEPARATE brand passwords
//   - per-email (UK Model 3): one customer record, a separate password per email
//
// This is extracted as a pure function so the mode -> copy mapping is unit-
// testable without a component-render harness, and so the "one password"
// wording can never leak onto a per-brand/per-email account by accident.

import type { PasswordModelSummary } from "./credential-model"

export type RecognitionCopyMode = "shared" | "per-brand" | "per-email"

/**
 * Resolve which topology the banner should describe. A missing model is treated
 * as the shared account (cases 1 & 2) — the historical default — so a first-
 * ever site with no derived model still reads correctly.
 */
export function recognitionCopyMode(
  passwordModel?: PasswordModelSummary,
): RecognitionCopyMode {
  // A pure shared-password account (or no model at all) keeps the original
  // "one password" wording.
  if (passwordModel?.singleSharedPassword ?? true) return "shared"
  // Per-brand takes precedence over per-email when both are somehow present:
  // the brand password is the coarser, more visible distinction to the user.
  if (passwordModel?.perBrand) return "per-brand"
  return "per-email"
}

const COPY: Record<RecognitionCopyMode, string> = {
  // EU Models 1 & 2 — unchanged one-password wording.
  shared:
    "Each Stanley Black & Decker site keeps its own sign-in, which is why we asked you again here, but it\u2019s one account, one password, one record in the directory.",
  // UK Model 4 — one customer record, but a SEPARATE password per brand.
  // The old copy wrongly implied "one password"; this states the truth.
  "per-brand":
    "You have one customer account with us \u2014 the same record across our brands \u2014 but each brand keeps its own separate password, so you sign in to each brand with that brand\u2019s password.",
  // UK Model 3 — one customer record, a separate password per email.
  "per-email":
    "This email carries its own password here \u2014 the same person, one customer record, with a separate password for this sign-in.",
}

/** The exact customer-facing recognition sentence for the account's topology. */
export function crossBrandRecognitionCopy(
  passwordModel?: PasswordModelSummary,
): string {
  return COPY[recognitionCopyMode(passwordModel)]
}
