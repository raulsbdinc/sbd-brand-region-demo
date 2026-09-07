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
}): ProfilePasswordModelVisibility {
  const uk = input.market === "uk"
  return {
    perEmail: uk && input.brand === "dewalt",
    perBrand: uk && input.brand === "stanley",
  }
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
