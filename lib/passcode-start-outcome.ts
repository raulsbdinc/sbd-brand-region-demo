/**
 * CIAM-20: decide, BEFORE any code is sent, whether a brand-scoped passcode
 * sign-in may proceed. Pure and framework-free so every branch is unit-tested.
 *
 *   - proceed:        the email resolves to an account enrolled in THIS brand
 *                     (exactly, or as a verified alias of that same customer).
 *   - not-registered: nothing on this tenant enrolls the email in this brand.
 *                     Covers a never-registered email, a customer enrolled
 *                     only in the other brand, and the wrong region (each
 *                     region is its own tenant, so the lookup finds nothing).
 *   - conflict:       more than one customer claims the email; fail closed.
 *   - unavailable:    the lookup failed or timed out. Never reported as
 *                     "not registered" and never as "code sent".
 */
export type PasscodeStartGate = "proceed" | "not-registered" | "conflict" | "unavailable"

export function gateBrandPasscodeStart(params: {
  resolutionKind: "resolved" | "shared-default" | "ambiguous" | "unavailable"
  resolvedConnectionKey?: string
  siteBrand: string
}): PasscodeStartGate {
  switch (params.resolutionKind) {
    case "unavailable":
      return "unavailable"
    case "ambiguous":
      return "conflict"
    case "resolved":
      return params.resolvedConnectionKey === params.siteBrand ? "proceed" : "not-registered"
    default:
      return "not-registered"
  }
}

/** HTTP status and code reported when the provider refuses or fails a send. */
export function passcodeSendFailure(error: unknown): {
  status: 429 | 503
  code: "throttled" | "provider-unavailable"
} {
  const status = (error as { status?: unknown } | null)?.status
  if (status === 429) return { status: 429, code: "throttled" }
  return { status: 503, code: "provider-unavailable" }
}

export const PASSCODE_NOT_REGISTERED_MESSAGE =
  "There's no account for this email on this site yet. Create an account to sign in."
export const PASSCODE_CONFLICT_MESSAGE =
  "We can't send a sign-in code to this email. Please contact customer support."
export const PASSCODE_THROTTLED_MESSAGE =
  "Too many code requests. Please wait a moment and try again."
export const PASSCODE_UNAVAILABLE_MESSAGE =
  "We couldn't send a code right now. Please try again in a moment."

/** Longest the interactive passcode send may take before it is reported unavailable. */
export const PASSCODE_SEND_TIMEOUT_MS = 8_000
