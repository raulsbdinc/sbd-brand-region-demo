// PASSCODE SIGN-IN HANDOFF COOKIE (server-only)
// =============================================
// Between /api/signin/passcode/start and .../verify we must remember, per
// browser, which flow ran, the address, and (database flow) the auth_session —
// WITHOUT ever telling the client any of it. We stash it in a short-lived
// httpOnly cookie. httpOnly keeps it out of client JS, and an HMAC over the
// payload (keyed on AUTH0_SECRET) stops a determined client from forging or
// swapping fields. The codec itself lives in lib/passcode-handoff-codec.ts.

import "server-only"
import type { PasscodeFlow } from "@/lib/auth0-passcode-signin"
import {
  HANDOFF_TTL_SECONDS,
  decodeHandoffWithKey,
  encodeHandoffWithKey,
  type HandoffCodecPayload,
} from "@/lib/passcode-handoff-codec"

export { HANDOFF_TTL_SECONDS }

export const HANDOFF_COOKIE_NAME = "__pc_ho"

/** Model 4 second-brand enrollment email-code proof (pre-send snapshot). */
export const ENROLL_PROOF_COOKIE = "__m4p_otp"

export interface HandoffPayload extends Omit<HandoffCodecPayload, "flow"> {
  /** "brand-proof": EU brand passcode delivered via the email connection as
   *  mailbox proof; verify re-resolves the brand-enrolled canonical.
   *  "brand-enroll-proof": Model 4 enrollment email-code proof. */
  flow: PasscodeFlow | "brand-proof" | "brand-enroll-proof"
}

export function handoffKey(): string {
  return process.env.AUTH0_SECRET ?? ""
}

/** Encode + sign a handoff payload for the Set-Cookie value. */
export function encodeHandoff(payload: HandoffPayload): string {
  return encodeHandoffWithKey(payload, handoffKey())
}

/** Verify + decode a handoff cookie. Returns null if missing/tampered/expired. */
export function decodeHandoff(raw: string | undefined): HandoffPayload | null {
  return decodeHandoffWithKey(raw, handoffKey()) as HandoffPayload | null
}
