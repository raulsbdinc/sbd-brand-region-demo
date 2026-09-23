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

export type RecognitionCopyMode =
  | "shared"
  | "per-brand"
  | "per-email"
  | "unresolved"

/**
 * Resolve which topology the banner should describe.
 *
 * `resolved` says whether the account's REAL password topology is actually
 * known yet. On the live profile the model is Management-backed and arrives
 * asynchronously (a second SWR request), so on the very first render we do NOT
 * yet know it. Asserting "one password" during that window is exactly the
 * Model 4 defect: a per-brand account briefly reads as one shared password
 * until the login-methods response lands. When `resolved` is false we return
 * the neutral "unresolved" copy, which is true for every model and never claims
 * a password count.
 *
 * When `resolved` is true, a missing model is treated as the shared account
 * (cases 1 & 2) — the historical default — so a first-ever site with no derived
 * model, and the server/dev callers that never pass a model, still read
 * correctly.
 */
export function recognitionCopyMode(
  passwordModel?: PasswordModelSummary,
  resolved = true,
): RecognitionCopyMode {
  // Topology not known yet: say nothing about how many passwords the account
  // has. This prevents the "one password" claim from flashing on a Model 4
  // (per-brand) or Model 3 (per-email) account before its real model loads.
  if (!resolved) return "unresolved"
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
  // Topology not yet known (live model still loading, or unavailable). True for
  // EVERY model — it names the shared record and per-site sign-in without ever
  // claiming a password count, so nothing wrong can flash before the real model
  // resolves.
  unresolved:
    "Each Stanley Black & Decker site keeps its own sign-in, which is why we asked you again here \u2014 it\u2019s the same account and one record in our directory.",
}

/**
 * The exact customer-facing recognition sentence for the account's topology.
 * Pass `resolved: false` while the real (Management-backed) model is still
 * loading so the copy never asserts a password count prematurely.
 */
export function crossBrandRecognitionCopy(
  passwordModel?: PasswordModelSummary,
  resolved = true,
): string {
  return COPY[recognitionCopyMode(passwordModel, resolved)]
}
