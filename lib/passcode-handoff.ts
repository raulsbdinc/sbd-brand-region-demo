// PASSCODE SIGN-IN HANDOFF COOKIE (server-only)
// =============================================
// Between /api/signin/passcode/start and .../verify we must remember, per
// browser, which flow ran, the address, and (database flow) the auth_session —
// WITHOUT ever telling the client any of it. We stash it in a short-lived
// httpOnly cookie. httpOnly keeps it out of client JS, and an HMAC over the
// payload (keyed on AUTH0_SECRET) stops a determined client from forging or
// swapping fields. The payload is opaque to the browser either way; the HMAC is
// belt-and-braces so verify can trust what start wrote.

import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import type { PasscodeFlow } from "@/lib/auth0-passcode-signin"

export const HANDOFF_COOKIE_NAME = "__pc_ho"
/** A few minutes — long enough to read the code from an inbox, no longer. */
export const HANDOFF_TTL_SECONDS = 5 * 60

export interface HandoffPayload {
  /** "brand-proof": EU brand passcode delivered via the email connection as
   *  mailbox proof; verify re-resolves the brand-enrolled canonical. */
  flow: PasscodeFlow | "brand-proof"
  email: string
  /** Only set on the database flow. */
  authSession?: string
  /** Epoch ms the handoff was minted, for a defence-in-depth expiry check. */
  iat: number
}

function key(): string {
  return process.env.AUTH0_SECRET ?? ""
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url")
}

/** Encode + sign a handoff payload for the Set-Cookie value. */
export function encodeHandoff(payload: HandoffPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${body}.${sign(body)}`
}

/** Verify + decode a handoff cookie. Returns null if missing/tampered/expired. */
export function decodeHandoff(raw: string | undefined): HandoffPayload | null {
  if (!raw) return null
  const dot = raw.lastIndexOf(".")
  if (dot < 0) return null
  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = sign(body)
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws then).
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as HandoffPayload
    if (typeof payload.iat !== "number") return null
    if (Date.now() - payload.iat > HANDOFF_TTL_SECONDS * 1000) return null
    return payload
  } catch {
    return null
  }
}
