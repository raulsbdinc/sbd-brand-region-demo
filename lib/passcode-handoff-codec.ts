// PASSCODE HANDOFF CODEC (pure, framework-free, tested)
// =====================================================
// HMAC-signed, expiring payload carried in the httpOnly handoff cookie between
// /api/signin/passcode/start and .../verify. Split out of passcode-handoff.ts
// (which is `server-only` and binds the key to AUTH0_SECRET) so the real codec
// can be exercised by the node test runner — tampered, expired and
// wrong-key handoffs are proven against THIS code, not a fake.

import { createHmac, timingSafeEqual } from "node:crypto"

/** A few minutes — long enough to read the code from an inbox, no longer. */
export const HANDOFF_TTL_SECONDS = 5 * 60

export interface HandoffCodecPayload {
  flow: string
  email: string
  /** Only set on the database flow. */
  authSession?: string
  /** Epoch ms the handoff was minted, for a defence-in-depth expiry check. */
  iat: number
  /** brand-proof only: the storefront brand that issued the challenge. */
  brand?: string
  /**
   * brand-proof only: every passwordless (`email|…`) account sub that already
   * existed for the address BEFORE the challenge was sent. `null` = the
   * snapshot could not be taken, so nothing can be proven new.
   */
  preExistingPasswordlessSubs?: string[] | null
  /** brand-enroll-proof only: the existing primary the proof is bound to. */
  primaryUserId?: string
}

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("base64url")
}

export function encodeHandoffWithKey(payload: HandoffCodecPayload, key: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${body}.${sign(body, key)}`
}

/** Verify + decode. Returns null if missing, tampered, wrong-key or expired. */
export function decodeHandoffWithKey(
  raw: string | undefined,
  key: string,
  now: number = Date.now(),
): HandoffCodecPayload | null {
  if (!raw) return null
  const dot = raw.lastIndexOf(".")
  if (dot < 0) return null
  const body = raw.slice(0, dot)
  const a = Buffer.from(raw.slice(dot + 1))
  const b = Buffer.from(sign(body, key))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HandoffCodecPayload
    if (typeof payload.iat !== "number") return null
    if (now - payload.iat > HANDOFF_TTL_SECONDS * 1000) return null
    return payload
  } catch {
    return null
  }
}
