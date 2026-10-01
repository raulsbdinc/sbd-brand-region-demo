// PER-BRAND PASSWORD ACTIONS — PURE, MODEL 4 PROFILE PLANNER
// ==========================================================
// GLSCM-4834 (follow-up): password management must be easy to discover on BOTH
// UK storefronts, not only DeWalt UK. DeWalt UK runs Model 3 (a separate
// password per EMAIL, planned by email-password-actions.ts). Stanley UK runs
// Model 4 (a separate password per BRAND — DeWalt vs Stanley — on ONE canonical
// account). This pure planner decides which brand-password rows the Model 4
// profile section shows, and the exact customer-facing label + scope line for
// each, so the two models never bleed into each other's storefront.
//
// It is FRAMEWORK-FREE (no "server-only", no React) so every visibility and
// labelling rule is unit-testable without Auth0 or the DOM. The password
// endpoints remain the real trust boundary; this only decides what to render.

import type { BrandId, CountryId } from "./types.ts"
import { UK_PER_EMAIL_ACCOUNTS_FLAG } from "./uk-feature-flags.ts"

/** The two brands that have their own per-brand connection/credential. */
export type ProfileBrand = "dewalt" | "stanley"

const BRAND_DISPLAY: Record<ProfileBrand, string> = {
  dewalt: "DeWalt",
  stanley: "Stanley",
}

/** Customer-facing brand name for a per-brand row. */
export function profileBrandName(brand: ProfileBrand): string {
  return BRAND_DISPLAY[brand]
}

// --- How the "How you sign in" list presents password credentials -----------
//
// GLSCM-4834 (follow-up 4): a Model 3 account is provisioned against a brand DB
// connection, so its login-methods legitimately include BOTH per-email and a
// brand credential. If the sign-in list rendered each of those as its own
// "Change password" row while the Email addresses section ALSO showed a change
// action beside each email, the customer saw the same action up to five times —
// including a confusing "DeWalt password" row inside a per-email model. When the
// per-email actions own password management (Model 3), the sign-in list must
// NOT repeat the individual credential rows; it shows one non-action summary
// row that points up to the Email addresses section instead.
export type SignInPasswordRows =
  | { mode: "summary"; name: string; line: string }
  | { mode: "credentials" }

export function planSignInPasswordRows(input: {
  /** True when the Email addresses section owns per-email password actions. */
  perEmailManaged: boolean
}): SignInPasswordRows {
  if (input.perEmailManaged) {
    return {
      mode: "summary",
      name: "Email passwords",
      line: "Managed beside each email address above.",
    }
  }
  return { mode: "credentials" }
}

// What the "How you sign in" password area should render, resolved from BOTH
// the parent's per-email flag AND the account's real login-methods. This is the
// SINGLE source of truth for the summary-vs-credentials decision so the sign-in
// list can never disagree with the Email addresses section.
//
// GLSCM-4834 (follow-up 5): the live regression was a parent that computed the
// per-email flag correctly but forgot to FORWARD it to the sign-in credential
// list, so a Model 3 account rendered raw per-credential rows (including a
// confusing brand-DB "DeWalt password" row) AND the beside-email actions. By
// also detecting per-email ownership from the very methods the list would
// render, the list refuses to show duplicate per-credential rows for a Model 3
// account regardless of whether the flag was forwarded. Per-email WINS the
// overlap: a canonical Model 3 account whose methods also include a brand DB
// credential is still summarized, never expanded into brand rows.
export type SignInPasswordDisplay = "summary" | "credentials" | "pending"

export function resolveSignInPasswordDisplay(input: {
  /** The parent's per-email ownership flag (may be unforwarded/false). */
  perEmailManaged: boolean
  /** Whether the login-methods fetch has produced data yet. */
  methodsLoaded: boolean
  /** The account's password login-methods (used to DETECT per-email ownership). */
  methods: { kind?: string | null; connectionKey?: string | null }[]
}): SignInPasswordDisplay {
  // Known from the parent — render the summary without waiting on a fetch.
  if (input.perEmailManaged) return "summary"
  // Can't decide credentials-vs-summary until we can inspect the real methods.
  if (!input.methodsLoaded) return "pending"
  // Defensive: the account genuinely manages passwords per-email → summarize,
  // even if the parent flag was not forwarded.
  if (accountCredentialFactsFromMethods(input.methods).hasPerEmailCredentials) {
    return "summary"
  }
  return "credentials"
}

/** Whether a value is one of the two per-brand ids. */
export function isProfileBrand(value: unknown): value is ProfileBrand {
  return value === "dewalt" || value === "stanley"
}

// --- Which password model each UK storefront exposes in /profile ------------
//
// The two UK storefronts each demonstrate exactly ONE identity model, and the
// profile must never expose the other model's controls:
//   • DeWalt UK  → Model 3 (per-email) actions beside each email.
//   • Stanley UK → Model 4 (per-brand) password section.
// EU (fr/de) storefronts expose NEITHER — they keep the single Account password.
// The non-prod `?market=uk` preview override is applied by the caller BEFORE
// this runs (it passes the effective market), so a fr/de preview can walk the
// UK journey for its own brand.

export interface ProfilePasswordModelVisibility {
  /** Show Model 3 per-email actions in the Email addresses section. */
  perEmail: boolean
  /** Show the Model 4 per-brand password section. */
  perBrand: boolean
}

/**
 * Decide, from the effective market + deployment brand, which password-model
 * controls the customer profile exposes. Exactly one model per UK storefront;
 * both false off the UK experience. Fails closed for any brand without a
 * per-brand connection (e.g. craftsman) and for non-UK markets.
 */
export function profilePasswordModelVisibility(input: {
  market: CountryId
  brand: BrandId
  /** UK per-email flag (default: the deployment flag, OFF unless set). */
  perEmailEnabled?: boolean
}): ProfilePasswordModelVisibility {
  const uk = input.market === "uk"
  const perEmailOn = input.perEmailEnabled ?? UK_PER_EMAIL_ACCOUNTS_FLAG
  const isBrand = input.brand === "dewalt" || input.brand === "stanley"
  // EU (FR/DE) runs separate brand passwords only; the per-email flag is
  // UK-scoped and never applies here.
  if (input.market === "fr" || input.market === "de") {
    return { perEmail: false, perBrand: isBrand }
  }
  if (!perEmailOn) {
    // Flag off: both UK storefronts run a separate password per brand only.
    return { perEmail: false, perBrand: uk && isBrand }
  }
  return {
    perEmail: uk && input.brand === "dewalt",
    perBrand: uk && input.brand === "stanley",
  }
}

// --- Account-AWARE section resolution (GLSCM-4834 follow-up) -----------------
//
// The host gates above pick which model a UK storefront DEFAULTS to for a fresh
// account (DeWalt UK → Model 3, Stanley UK → Model 4). But a single canonical
// account can be a Model 4 account (separate DeWalt + Stanley passwords) and be
// viewed from EITHER UK storefront. Inferring presentation from the host alone
// meant a Model 4 account opened on DeWalt UK saw NO brand-password section and
// the wrong "one password" welcome copy. Presentation must instead follow the
// account's REAL credentials (from login-methods), with the host only deciding
// the default for an account that has no scoped credentials yet.

/** What the loaded account actually has, derived from its login-methods. */
export interface AccountCredentialFacts {
  /** The account holds at least one per-email (Model 3) password credential. */
  hasPerEmailCredentials: boolean
  /** The account holds at least one per-brand (Model 4) password credential. */
  hasBrandCredentials: boolean
}

/**
 * Derive the account credential facts from a login-methods list. Only
 * password-kind rows with a scoped connection key count; a shared/base password
 * is neither per-email nor per-brand. Framework-free and structural so the
 * detection is unit-testable without Auth0 or SWR.
 */
export function accountCredentialFactsFromMethods(
  methods: { kind?: string | null; connectionKey?: string | null }[],
): AccountCredentialFacts {
  let hasPerEmailCredentials = false
  let hasBrandCredentials = false
  for (const m of methods) {
    if (m.kind && m.kind !== "password") continue
    if (m.connectionKey === "per-email") hasPerEmailCredentials = true
    else if (m.connectionKey === "dewalt" || m.connectionKey === "stanley") {
      hasBrandCredentials = true
    }
  }
  return { hasPerEmailCredentials, hasBrandCredentials }
}

/** Which discoverable password sections the customer profile should render. */
export interface ProfilePasswordSections {
  /** Model 3 per-email actions beside each verified email (Email addresses). */
  showPerEmailActions: boolean
  /** Model 4 prominent Brand passwords section. */
  showBrandSection: boolean
  /**
   * Flag off + the account holds older per-email passwords: show neutral
   * guidance only (no conversion, no setup controls).
   */
  legacyPerEmailAccount?: boolean
}

/**
 * Resolve which password-management sections the profile shows, account-aware.
 *
 * Rules (fail CLOSED — an unknown model shows no special section):
 *   • Off the UK experience entirely (EU Models 1/2) → neither section, so the
 *     single Account password stays the only control.
 *   • PER-EMAIL WINS THE OVERLAP. A canonical Model 3 account naturally also
 *     holds a brand DB credential, so its facts can be {perEmail:true,
 *     brand:true}. Whenever verified per-email password credentials exist the
 *     account IS Model 3: show only the per-email actions (host-gated to the
 *     per-email storefront) and NEVER the Brand passwords section.
 *   • Model 4 (brand credentials AND no per-email credentials) → the Brand
 *     passwords section on EITHER UK storefront, and never the per-email
 *     actions. Also shown on the per-brand host storefront for a fresh account
 *     with no scoped credentials yet (so it can set its first brand password).
 *   • Model 3 follows the account: a real per-email account gets per-email
 *     actions on BOTH UK storefronts. With no scoped credentials yet, only the
 *     per-email host (DeWalt UK) defaults to them.
 */
export function resolveProfilePasswordSections(input: {
  /** Host default: this storefront is the per-email (DeWalt UK) storefront. */
  hostPerEmailModel: boolean
  /** Host default: this storefront is the per-brand (Stanley UK) storefront. */
  hostPerBrandModel: boolean
  facts: AccountCredentialFacts
  /** UK per-email flag (default: the deployment flag, OFF unless set). */
  perEmailEnabled?: boolean
}): ProfilePasswordSections {
  const isUk = input.hostPerEmailModel || input.hostPerBrandModel
  const { hasPerEmailCredentials, hasBrandCredentials } = input.facts
  const perEmailOn = input.perEmailEnabled ?? UK_PER_EMAIL_ACCOUNTS_FLAG

  if (!perEmailOn) {
    // An existing per-email account is never converted or merged into brand
    // passwords: it gets NO password-setup controls (neither per-email nor
    // brand), only neutral guidance that its current passwords keep working.
    if (isUk && hasPerEmailCredentials) {
      return { showPerEmailActions: false, showBrandSection: false, legacyPerEmailAccount: true }
    }
    return { showPerEmailActions: false, showBrandSection: isUk, legacyPerEmailAccount: false }
  }

  // Per-email credentials define a Model 3 account even when a brand DB
  // credential co-exists. Model 4 is brand credentials WITHOUT per-email.
  const isModel4Account = hasBrandCredentials && !hasPerEmailCredentials

  const showBrandSection =
    isUk &&
    !hasPerEmailCredentials &&
    (hasBrandCredentials || input.hostPerBrandModel)

  // A Model 3 account (real per-email credentials) is managed the same way on
  // EITHER UK storefront, whichever site it signed up on. The per-email host
  // (DeWalt UK) additionally defaults a fresh account to Model 3. A brand-only
  // account on Stanley UK is deliberately NOT given per-email activation here:
  // the combined per-email x per-brand topology is pending a stakeholder decision.
  const showPerEmailActions =
    isUk && !isModel4Account && (hasPerEmailCredentials || input.hostPerEmailModel)

  return { showPerEmailActions, showBrandSection }
}

// --- Model 4 brand rows -----------------------------------------------------

export type BrandPasswordActionKind = "set" | "change"

export interface BrandPasswordRow {
  /** The brand this row manages a password for. */
  brand: ProfileBrand
  /** Customer-facing brand name, e.g. "Stanley". */
  brandName: string
  /** "set" when eligible to provision now; "change" when a credential exists. */
  kind: BrandPasswordActionKind
  /** The action button label, e.g. "Set Stanley password". */
  label: string
  /** The affected-scope line shown before submitting — always names the brand. */
  scopeLine: string
}

/** The action button label for a brand row — always names the exact brand. */
export function brandPasswordActionLabel(
  kind: BrandPasswordActionKind,
  brandName: string,
): string {
  return kind === "set" ? `Set ${brandName} password` : `Change ${brandName} password`
}

/**
 * The affected-scope line for a brand row. Model 4's promise is that a brand
 * password applies to ONE brand only, so the copy names the brand and states
 * the other brand's password is untouched — visible before the customer submits.
 */
export function brandPasswordScopeLine(brandName: string): string {
  return `Applies only to your ${brandName} sign-in. Your other brand password is unaffected.`
}

export interface PlanBrandPasswordRowsInput {
  /** Model 4 gate — true only on the per-brand (Stanley) UK storefront. */
  perBrandModelAvailable: boolean
  /** The storefront's own brand (SITE_BRAND). */
  deploymentBrand: BrandId
  /** Brands that ALREADY have their own password credential (from login-methods). */
  existingBrandCredentials: ProfileBrand[]
  /**
   * Whether THIS storefront's brand password can be provisioned right now
   * (GET /api/account/passwords → availability.thisBrand.available). A brand
   * other than the deployment brand can never be *set* from here (that is the
   * signed-out cross-brand registration journey) — only *changed* if it exists.
   */
  thisBrandProvisionable: boolean
}

/**
 * Plan the brand-password rows the Model 4 profile section renders.
 *
 * Rules (fail CLOSED to no rows):
 *   • Off the Model 4 (Stanley UK) experience → no rows.
 *   • The deployment brand comes FIRST, then the other brand — so the customer
 *     always sees the brand they are shopping at the top.
 *   • A brand that already has a credential → a "change" row (works for either
 *     brand, since a linked cross-brand credential is changeable in place).
 *   • The deployment brand with no credential yet, when provisionable → a "set"
 *     row (reuses the existing this-brand provisioning endpoint).
 *   • The OTHER brand with no credential → no row (can't be set from this
 *     storefront; that's the signed-out cross-brand registration flow).
 */
export function planBrandPasswordRows(
  input: PlanBrandPasswordRowsInput,
): BrandPasswordRow[] {
  if (!input.perBrandModelAvailable) return []
  if (!isProfileBrand(input.deploymentBrand)) return []

  const existing = new Set(
    input.existingBrandCredentials.filter(isProfileBrand),
  )

  const other: ProfileBrand = input.deploymentBrand === "dewalt" ? "stanley" : "dewalt"
  const order: ProfileBrand[] = [input.deploymentBrand, other]

  const rows: BrandPasswordRow[] = []
  for (const brand of order) {
    const brandName = profileBrandName(brand)
    if (existing.has(brand)) {
      rows.push({
        brand,
        brandName,
        kind: "change",
        label: brandPasswordActionLabel("change", brandName),
        scopeLine: brandPasswordScopeLine(brandName),
      })
    } else if (brand === input.deploymentBrand && input.thisBrandProvisionable) {
      rows.push({
        brand,
        brandName,
        kind: "set",
        label: brandPasswordActionLabel("set", brandName),
        scopeLine: brandPasswordScopeLine(brandName),
      })
    }
  }
  return rows
}
