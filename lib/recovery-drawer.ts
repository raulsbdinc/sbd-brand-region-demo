// PURE DRAWER-RECOVERY INTERPRETERS
// =================================
// The storefront's "Forgot password?" flow lives ENTIRELY inside the one
// standard auth drawer: enter email -> receive an emailed one-time code ->
// choose a new password -> success -> back to Sign in. No standalone page, no
// model/architecture language.
//
// This module is framework-free (no React/DOM/Auth0) so the response mapping,
// the submit gate, and the credential-selector derivation are all unit-testable
// in isolation. The drawer imports these and only owns the visual state.

import { validateNewPassword } from "./password-change.ts"

// --- Recovery OTP start ------------------------------------------------------

/** What the drawer should do after asking the server to email a reset code. */
export type RecoveryStartAction =
  | { kind: "sent" }
  | { kind: "brand-not-set-up"; message: string }
  | { kind: "error"; message?: string }

/**
 * CIAM-17 (UK): the response code used when the email only has the SISTER
 * brand's password — nothing here to reset, so no code is sent and the customer
 * is guided to Create Account's second-brand ownership proof instead.
 */
export const BRAND_NOT_SET_UP_CODE = "brand-not-set-up"

/** Customer-facing guidance for BRAND_NOT_SET_UP_CODE. Never names the other brand. */
export function brandNotSetUpMessage(brandName: string): string {
  return `${brandName} sign-in isn\u2019t set up for this email yet, so there\u2019s no ${brandName} password to reset. Choose Create an account with this same email to add ${brandName} \u2014 we\u2019ll confirm it\u2019s you, and your existing passwords stay unchanged.`
}

/**
 * Interpret the response of POST /api/recovery/passcode/start. The start step
 * is deliberately NON-enumerating: a 2xx always means "a code is on its way if
 * the address is eligible", so we advance to the code step. Only a transport /
 * server failure keeps the customer on the email step with a retry message.
 */
export function interpretRecoveryStartResponse(input: {
  httpStatus: number
  body: Record<string, unknown>
}): RecoveryStartAction {
  if (input.httpStatus >= 200 && input.httpStatus < 300) {
    if (input.body.code === BRAND_NOT_SET_UP_CODE && typeof input.body.message === "string") {
      return { kind: "brand-not-set-up", message: input.body.message }
    }
    return { kind: "sent" }
  }
  const message =
    typeof input.body.error === "string" ? input.body.error : undefined
  return { kind: "error", message }
}

// --- Recovery reset ----------------------------------------------------------

/** The customer-facing scope of the credential that was reset. */
export type RecoveryResetScope = "per-email" | "brand" | "shared"

/** What the drawer should do after submitting the code + new password. */
export type RecoveryResetAction =
  | {
      kind: "reset"
      email?: string
      scope?: RecoveryResetScope
      brandName?: string
    }
  | { kind: "bad-code" }
  | { kind: "weak-password" }
  | { kind: "brand-not-set-up"; message: string }
  | { kind: "generic"; message?: string }

/**
 * Interpret the response of POST /api/recovery/reset.
 *   • 2xx                       -> the exact credential's password was reset.
 *   • 400 code === "bad-code"   -> wrong/expired one-time code (stay on step).
 *   • 400 code === "weak-password" -> new password failed the policy.
 *   • anything else             -> a neutral generic failure.
 */
export function interpretRecoveryResetResponse(input: {
  httpStatus: number
  body: Record<string, unknown>
}): RecoveryResetAction {
  const { httpStatus, body } = input
  if (httpStatus >= 200 && httpStatus < 300) {
    const credential = (body.credential ?? {}) as Record<string, unknown>
    const scope =
      credential.scope === "per-email" ||
      credential.scope === "brand" ||
      credential.scope === "shared"
        ? (credential.scope as RecoveryResetScope)
        : undefined
    return {
      kind: "reset",
      email: typeof credential.email === "string" ? credential.email : undefined,
      scope,
      brandName:
        typeof credential.brandName === "string" ? credential.brandName : undefined,
    }
  }
  const code = typeof body.code === "string" ? body.code : ""
  if (httpStatus === 400 && code === "bad-code") return { kind: "bad-code" }
  if (httpStatus === 400 && code === "weak-password") return { kind: "weak-password" }
  if (code === BRAND_NOT_SET_UP_CODE && typeof body.error === "string") {
    return { kind: "brand-not-set-up", message: body.error }
  }
  const message = typeof body.error === "string" ? body.error : undefined
  return { kind: "generic", message }
}

/**
 * Build the polished, customer-facing success line naming EXACTLY which
 * password changed. Only reached AFTER the emailed code proved ownership of the
 * mailbox, so showing the exact submitted address is appropriate. Never exposes
 * "per-email", "binding", model numbers, or connection names:
 *   • per-email (Model 3) -> "The password for <email> has been updated."
 *   • brand     (Model 4) -> "Your <Brand> password has been updated."
 *   • shared / anything unresolved -> "Your password has been updated."
 */
export function recoverySuccessMessage(action: {
  scope?: RecoveryResetScope
  email?: string
  brandName?: string
}): string {
  if (action.scope === "per-email" && action.email) {
    return `The password for ${action.email} has been updated.`
  }
  if (action.scope === "brand" && action.brandName) {
    return `Your ${action.brandName} password has been updated.`
  }
  return "Your password has been updated."
}

/**
 * Whether the reset form may submit. Pure so the drawer's disable rule and its
 * tests agree exactly: a code is present, the new password meets the baseline
 * policy, and the confirmation matches.
 */
export function canSubmitRecoveryReset(input: {
  code: string
  next: string
  confirm: string
  market?: string
  email?: string
}): boolean {
  if (input.code.trim().length === 0) return false
  if (!validateNewPassword(input.next, input.market, input.email ? [input.email] : []).ok) return false
  if (input.next !== input.confirm) return false
  return true
}

// --- Credential selector derivation -----------------------------------------
// The recovery reset must target EXACTLY the credential the typed email signs
// in with on THIS storefront brand — never ask the customer which model they
// use. The server resolves (email + brand) to a sign-in credential; this pure
// helper maps that resolution to the SAME selector the in-site password-change
// route accepts, so the exact-identity write path is reused verbatim.

/** The shape the sign-in resolver hands back (only the fields we branch on). */
export interface RecoveryResolutionLike {
  kind: "resolved" | "shared-default" | "ambiguous" | "unavailable"
  /** Present only for a "resolved" per-email / per-brand credential. */
  binding?: { id?: string | null } | null
}

/** A target selector for the password-change coordinates resolver, or null. */
export type RecoverySelector = { scope: "shared" } | { bindingId: string }

/**
 * Derive the credential selector for a recovery reset from the sign-in
 * resolution, or null when we must fail closed:
 *   • "resolved" WITH a binding id -> the exact per-email / per-brand credential
 *     (Model 3 resets only that email; Model 4 resets only the current brand).
 *   • "shared-default"             -> the account's shared credential (Model 1/2).
 *   • "resolved" without a usable binding id, "ambiguous", "unavailable"
 *                                  -> null (never guess which credential to reset).
 */
export function selectorForRecovery(
  resolution: RecoveryResolutionLike,
): RecoverySelector | null {
  if (resolution.kind === "shared-default") return { scope: "shared" }
  if (resolution.kind === "resolved") {
    const id = resolution.binding?.id
    if (typeof id === "string" && id.trim()) return { bindingId: id.trim() }
    return null
  }
  return null
}
