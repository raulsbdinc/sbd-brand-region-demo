// GOOGLE-LINK HANDOFF COOKIE (server-only)
// ========================================
// The "Connect Google" link flow spans two GET routes with a full Auth0 round
// trip in between (start → /auth/login → Google → /auth/callback → complete).
// Across that trip we must remember WHICH signed-in account initiated the link
// — its primary `sub` — because by the time `complete` runs the SDK session has
// been replaced by whatever the Google login resolved to. We stash the primary
// sub in a short-lived httpOnly cookie, exactly like the passcode sign-in
// handoff (lib/passcode-handoff.ts): httpOnly keeps it out of client JS, and an
// HMAC over the payload (keyed on AUTH0_SECRET) stops a client forging or
// swapping the sub to hijack a link onto someone else's account.
//
// This is deliberately its OWN cookie + module, separate from the passcode
// handoff, so the two flows can never read or clobber each other's state.

import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

export const GOOGLE_LINK_COOKIE_NAME = "__gl_ho"
/** A few minutes — long enough for one Google round trip, no longer. */
export const GOOGLE_LINK_TTL_SECONDS = 5 * 60

export interface GoogleLinkHandoff {
  /** The primary account `sub` that started the link while signed in. */
  primarySub: string
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
export function encodeGoogleLinkHandoff(payload: GoogleLinkHandoff): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${body}.${sign(body)}`
}

/** Verify + decode a handoff cookie. Returns null if missing/tampered/expired. */
export function decodeGoogleLinkHandoff(
  raw: string | undefined,
): GoogleLinkHandoff | null {
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
    ) as GoogleLinkHandoff
    if (typeof payload.primarySub !== "string" || !payload.primarySub) return null
    if (typeof payload.iat !== "number") return null
    if (Date.now() - payload.iat > GOOGLE_LINK_TTL_SECONDS * 1000) return null
    return payload
  } catch {
    return null
  }
}
