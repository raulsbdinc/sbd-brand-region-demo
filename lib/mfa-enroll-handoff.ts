// AUTHENTICATOR ENROLMENT HANDOFF COOKIE (server-only)
// ====================================================
// Between /api/account/mfa/enroll/start and .../verify we must remember, per
// browser, the pending TOTP secret we issued — so the code the person types is
// always checked against the SAME secret that produced the QR they scanned, and
// a tampered-with secret can never be slipped in at verify time. We stash it in
// a short-lived httpOnly cookie, HMAC-signed over the payload (keyed on
// AUTH0_SECRET), exactly like the passcode sign-in handoff. httpOnly keeps it
// out of client JS; the HMAC stops a determined client forging it.
//
// The otpauth URI (which also contains the secret) is returned to the browser
// so it can draw the QR — that is unavoidable and expected. Keeping the secret
// in this cookie as well means verify trusts the server's copy, not the body.

import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

export const MFA_ENROLL_COOKIE_NAME = "__mfa_enroll"
/** A few minutes — long enough to scan and read a code, no longer. */
export const MFA_ENROLL_TTL_SECONDS = 10 * 60

export interface MfaEnrollPayload {
  /** The pending base32 TOTP secret (no spaces). */
  secret: string
  /** The account label the URI was minted for (the user's email). */
  account: string
  /** Epoch ms the handoff was minted, for a defence-in-depth expiry check. */
  iat: number
}

function key(): string {
  return process.env.AUTH0_SECRET ?? ""
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url")
}

/** Encode + sign an enrolment payload for the Set-Cookie value. */
export function encodeMfaEnroll(payload: MfaEnrollPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${body}.${sign(body)}`
}

/** Verify + decode the cookie. Returns null if missing/tampered/expired. */
export function decodeMfaEnroll(raw: string | undefined): MfaEnrollPayload | null {
  if (!raw) return null
  const dot = raw.lastIndexOf(".")
  if (dot < 0) return null
  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = sign(body)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as MfaEnrollPayload
    if (typeof payload.iat !== "number") return null
    if (Date.now() - payload.iat > MFA_ENROLL_TTL_SECONDS * 1000) return null
    if (!payload.secret || !payload.account) return null
    return payload
  } catch {
    return null
  }
}
