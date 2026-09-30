// STOREFRONT CREATE-ACCOUNT DRAWER ROUTING — PURE
// ===============================================
// The ONE Create Account drawer is shared by every storefront (DeWalt/Stanley,
// FR/DE/UK). The customer NEVER picks an account model. This framework-free
// module is the brain that decides, from the deployment's market + brand alone,
//
//   • WHERE the drawer posts a sign-up:
//       - non-UK (FR/DE)  → the shared Model 1/2 signup (/api/signup),
//       - DeWalt UK       → the per-email endpoint (/api/registration/per-email).
//         Nothing is created until the emailed one-time code is consumed, so a
//         new DeWalt account is Model 3 and the profile can offer "Set separate
//         password" on a later verified address.
//       - Stanley UK     → the per-brand endpoint (/api/registration/brand),
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
import { UK_PER_EMAIL_ACCOUNTS_FLAG, perEmailAccountsEnabled } from "./uk-feature-flags.ts"
import {
  accountModelSelectionAvailable,
  brandConnectionKey,
  crossBrandConfirmMessage,
  modelMismatchMessage,
  unverifiedBrandAccountMessage,
} from "./account-model.ts"

/** Which Create Account endpoint this storefront's drawer posts to. */
export type DrawerSignupFlow = "shared" | "per-email" | "per-brand"

/**
 * Where Create Account posts, from the deployment's market and brand.
 *
 * DeWalt UK is Model 3 (a password per email). Stanley UK is Model 4 (a
 * password per brand). Every other market keeps the shared Model 1/2 signup.
 * A UK brand with no brand connection fails closed to the shared signup; the
 * server routes still re-gate and refuse a model that market cannot host.
 */
export function drawerSignupFlow(
  market: CountryId,
  brand: BrandId,
  choice?: UkSignupModel,
  perEmailEnabled: boolean = perEmailAccountsEnabled(market),
): DrawerSignupFlow {
  if (!accountModelSelectionAvailable(market)) return "shared"
  if (!brandConnectionKey(brand)) return "shared"
  const model = choice ?? defaultUkSignupModel(brand, perEmailEnabled)
  // With the per-email setup switched off, a stale or forged per-email choice
  // falls back to the brand password — never to a shared cross-brand password.
  if (model === "per-email" && !perEmailEnabled) return "per-brand"
  return model
}

/**
 * The UK account setups Create Account can offer. With the per-email flag on,
 * both are offered on both UK storefronts. With it off (the default), only a
 * separate password for each brand.
 */
export type UkSignupModel = "per-email" | "per-brand"

export const UK_SIGNUP_MODELS: readonly UkSignupModel[] = ["per-email", "per-brand"]

export function ukSignupModels(perEmailEnabled: boolean): readonly UkSignupModel[] {
  return perEmailEnabled ? UK_SIGNUP_MODELS : ["per-brand"]
}

/**
 * The pre-selected option. Flag off: always a separate brand password. Flag on
 * (historical): DeWalt UK starts on a password per email, Stanley UK per brand.
 */
export function defaultUkSignupModel(
  brand: BrandId,
  perEmailEnabled: boolean = UK_PER_EMAIL_ACCOUNTS_FLAG,
): UkSignupModel {
  if (!perEmailEnabled) return "per-brand"
  return brand === "dewalt" ? "per-email" : "per-brand"
}

/**
 * Plain-language explainer shown in Create Account when the separate brand
 * password is the only UK setup. No model numbers, no connection names.
 */
export function ukBrandPasswordIntro(siteBrand: BrandId): { title: string; description: string } {
  const here = BRANDS[siteBrand].name
  const other = otherUkBrand(siteBrand)
  const otherName = other ? BRANDS[other].name : "our other brand"
  return {
    title: `Your ${here} password`,
    description: `Choose a password for ${here}. You can use the same verified email with ${otherName}, but ${otherName} needs its own different password \u2014 we\u2019ll email you a code to confirm it\u2019s you before adding it. You always sign in with your email and the password for the site you\u2019re on.`,
  }
}

/** Plain-language option copy. Never mentions Auth0 connections. */
export function ukSignupModelCopy(
  model: UkSignupModel,
  siteBrand: BrandId,
): { title: string; description: string } {
  const here = BRANDS[siteBrand].name
  const other = otherUkBrand(siteBrand)
  const otherName = other ? BRANDS[other].name : "the other brand"
  if (model === "per-email") {
    return {
      title: "A password for each email",
      description: `Later you can add another verified email with its own password. Both work on ${here} and ${otherName}.`,
    }
  }
  return {
    title: `A separate ${here} password`,
    description: `This password works on ${here} only. You can add a different ${otherName} password to the same account later.`,
  }
}

/**
 * CIAM-17 recovery → Create Account handoff. The recovery gate
 * (`detectOtherBrandOnlyCredential`) only fires when the email's account holds
 * the SISTER brand's password and no per-email / shared / this-brand password —
 * i.e. an existing per-brand (Model 4) account. Carrying the default Model 3
 * pre-selection into Create Account would mismatch that account, so the drawer
 * pre-selects the separate brand password and explains why. The customer may
 * still change it (the server fails closed on a genuine mismatch). The note
 * never names the other brand, matching the recovery message.
 */
export interface RecoverySignupPreset {
  model: UkSignupModel
  note: string
}

export function recoverySignupPreset(
  siteBrand: BrandId,
  perEmailEnabled: boolean = UK_PER_EMAIL_ACCOUNTS_FLAG,
): RecoverySignupPreset {
  const here = BRANDS[siteBrand].name
  if (!perEmailEnabled) {
    return {
      model: "per-brand",
      note: `This email already has a password for one of our other brands. Choose a new, different ${here} password \u2014 we\u2019ll email you a code to confirm it\u2019s you, and your existing password stays unchanged.`,
    }
  }
  const title = ukSignupModelCopy("per-brand", siteBrand).title
  return {
    model: "per-brand",
    note: `This email already uses a separate password for one of our brands, so we\u2019ve selected \u201C${title}\u201D to match. Choose a new ${here} password \u2014 we\u2019ll email you a code to confirm it\u2019s you, and your existing password stays unchanged.`,
  }
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
  | { kind: "model-mismatch"; message: string }
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

  // The email belongs to an account on the OTHER demo model. Nothing was
  // created; show the route's explanation instead of a generic failure.
  if (httpStatus === 409 && body.reason === "model-mismatch") {
    return { kind: "model-mismatch", message: messageOf(body) ?? modelMismatchMessage("other") }
  }

  // Same model, but the first brand's email isn't confirmed yet. Surface the
  // route's guidance (reuses the explanatory model-mismatch panel; nothing made).
  if (httpStatus === 409 && body.reason === "email-unverified") {
    return { kind: "model-mismatch", message: messageOf(body) ?? unverifiedBrandAccountMessage() }
  }

  return { kind: "error", message: messageOf(body) }
}

/**
 * The drawer's reaction to a /api/registration/brand/proof response.
 *   - linked         : the second brand identity was created + linked ��� sign in.
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

/**
 * The drawer's reaction to POST /api/registration/per-email/verify/start.
 *   - code-sent      : a one-time code was emailed; nothing is created. The
 *                      ordinary Model 3 proof step follows.
 *   - proof-required : the SAME email already owns the OTHER UK brand. We must
 *                      NOT mint a per-email user — instead the drawer switches to
 *                      the SAME cross-brand proof step the per-brand (Stanley)
 *                      drawer uses, so this becomes a second brand password on
 *                      the existing account. `canEmailCode` mirrors whether the
 *                      endpoint offered the email-code proof option.
 *   - not-configured : the honest refusal when this storefront can't host Model 3.
 *   - error          : anything else, with a neutral message when present.
 */
export type PerEmailCodeAction =
  | { kind: "code-sent" }
  | { kind: "proof-required"; canEmailCode: boolean }
  | { kind: "not-configured" }
  | { kind: "error"; message?: string }

export function interpretPerEmailCodeStart(res: HttpResult): PerEmailCodeAction {
  const { httpStatus, body } = res
  if (body.configured === false) return { kind: "not-configured" }
  if (httpStatus === 200 && body.status === "code-sent") return { kind: "code-sent" }
  // The email already owns the other UK brand: do not create a per-email user —
  // divert into the cross-brand proof step (identical to the per-brand drawer).
  if (httpStatus === 200 && body.status === "cross-brand-required") {
    const options = Array.isArray(body.proofOptions) ? body.proofOptions : []
    return { kind: "proof-required", canEmailCode: options.includes("email-code") }
  }
  return { kind: "error", message: messageOf(body) }
}

/**
 * The drawer's reaction to POST /api/registration/per-email. The account
 * exists only after `created`. A bad or expired code stays on the proof step
 * so the customer can ask for another.
 */
export type PerEmailCreateAction =
  | { kind: "created" }
  | { kind: "bad-code" }
  | { kind: "not-configured" }
  | { kind: "error"; message?: string }

export function interpretPerEmailCreateResponse(res: HttpResult): PerEmailCreateAction {
  const { httpStatus, body } = res
  if (body.configured === false) return { kind: "not-configured" }
  if (httpStatus === 201 && body.status === "created") return { kind: "created" }
  if (httpStatus === 401) return { kind: "bad-code" }
  return { kind: "error", message: messageOf(body) }
}
