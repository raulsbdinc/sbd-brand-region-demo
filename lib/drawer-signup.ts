// STOREFRONT CREATE-ACCOUNT DRAWER ROUTING — PURE
// ===============================================
// The ONE Create Account drawer is shared by every storefront (DeWalt/Stanley,
// FR/DE/UK). The customer NEVER picks an account model. This framework-free
// module is the brain that decides, from the deployment's market + brand alone,
//
//   • WHERE the drawer posts a sign-up:
//       - non-UK (FR/DE)  → the shared Model 1/2 signup (/api/signup),
//       - UK (DeWalt/Stanley) → the per-brand endpoint (/api/registration/brand)
//         which transparently does either a first-brand create OR — when the
//         SAME email already owns the OTHER UK brand — a cross-brand link after
//         an emailed one-time code, all inside the drawer.
//   • HOW to interpret the per-brand endpoint's responses into a small set of
//     drawer actions, so the (client) component holds no model/branching logic.
//
// It has NO "server-only" import and never talks to Auth0, so every rule is
// unit-testable. The server routes remain the security boundary — they re-gate
// market/brand and resolve every connection server-side regardless of anything
// decided here.

import { BRANDS } from "./brands.ts"
import type { BrandId, CountryId } from "./types.ts"
import {
  accountModelSelectionAvailable,
  brandConnectionKey,
  crossBrandConfirmMessage,
} from "./account-model.ts"

/**
 * Whether this market's Create Account drawer uses the per-brand (Model 4)
 * endpoint instead of the shared signup. Only UK deployments do; every other
 * market keeps the untouched shared (Model 1/2) signup. Delegates to the same
 * predicate the server routes gate on, so the client and server never diverge.
 */
export function signupUsesBrandFlow(market: CountryId): boolean {
  return accountModelSelectionAvailable(market)
}

/**
 * The OTHER UK brand for a storefront brand: DeWalt ⇄ Stanley. Returns null for
 * any brand without a UK brand connection (e.g. craftsman), so callers fail
 * closed rather than inventing a partner brand.
 */
export function otherUkBrand(siteBrand: BrandId): BrandId | null {
  const key = brandConnectionKey(siteBrand)
  if (key === "dewalt") return "stanley"
  if (key === "stanley") return "dewalt"
  return null
}

/**
 * The cross-brand collision sentence shown in the drawer when the typed email
 * already owns the OTHER UK brand and we're about to add THIS brand after an
 * emailed one-time code. Reuses the tested pure copy helper with both real brand
 * names interpolated. Null when this storefront has no UK partner brand.
 */
export function crossBrandCollisionMessage(siteBrand: BrandId): string | null {
  const other = otherUkBrand(siteBrand)
  if (!other) return null
  return crossBrandConfirmMessage(BRANDS[siteBrand].name, BRANDS[other].name)
}

// --- Response interpretation ------------------------------------------------

interface HttpResult {
  httpStatus: number
  body: Record<string, unknown>
}

/**
 * The drawer's reaction to a /api/registration/brand response.
 *   - created        : a brand-new first-brand account was created → sign in.
 *   - proof-required : the SAME email owns the other UK brand → keep the user in
 *                      the drawer, email a one-time code, then link. `canEmailCode`
 *                      is whether the endpoint offered the email-code option.
 *   - brand-exists   : this brand already has a credential → existing-account /
 *                      sign-in guidance, never a duplicate.
 *   - not-configured : the deployment lacks the case-3/4 Auth0 connections.
 *   - error          : anything else, with a neutral message when present.
 */
export type BrandSignupAction =
  | { kind: "created" }
  | { kind: "proof-required"; canEmailCode: boolean }
  | { kind: "brand-exists" }
  | { kind: "not-configured" }
  | { kind: "error"; message?: string }

function messageOf(body: Record<string, unknown>): string | undefined {
  return typeof body.error === "string" ? body.error : undefined
}

export function interpretBrandSignupResponse(res: HttpResult): BrandSignupAction {
  const { httpStatus, body } = res

  // Neutral "not available on this storefront" (real market isn't UK, or the
  // case-3/4 connections aren't configured). The endpoint returns 200 for this.
  if (body.configured === false) return { kind: "not-configured" }

  if (httpStatus === 201 && body.status === "created") return { kind: "created" }

  if (httpStatus === 200 && body.status === "proof-required") {
    const options = Array.isArray(body.proofOptions) ? body.proofOptions : []
    return { kind: "proof-required", canEmailCode: options.includes("email-code") }
  }

  // Additive discriminator from the route: this brand already has a credential.
  if (httpStatus === 409 && body.reason === "already-brand") {
    return { kind: "brand-exists" }
  }

  return { kind: "error", message: messageOf(body) }
}

/**
 * The drawer's reaction to a /api/registration/brand/proof response.
 *   - linked         : the second brand identity was created + linked → sign in.
 *   - bad-code       : the emailed one-time code was wrong / expired.
 *   - not-configured : deployment not configured for case 3/4.
 *   - error          : anything else, with a neutral message when present.
 */
export type BrandProofAction =
  | { kind: "linked" }
  | { kind: "bad-code" }
  | { kind: "not-configured" }
  | { kind: "error"; message?: string }

export function interpretBrandProofResponse(res: HttpResult): BrandProofAction {
  const { httpStatus, body } = res
  if (body.configured === false) return { kind: "not-configured" }
  if (httpStatus === 201 && body.status === "linked") return { kind: "linked" }
  if (httpStatus === 401) return { kind: "bad-code" }
  return { kind: "error", message: messageOf(body) }
}
