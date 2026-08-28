// JOURNEY HANDOFF COOKIES (server-only)
// =====================================
// Thin server wrapper around the pure lib/handoff-token.ts codec. It supplies
// the signing secret (AUTH0_SECRET) and standardises the httpOnly cookie
// attributes for the cross-request journeys:
//   - model3-register : ownership proof carried across the signed-out sign-up
//   - model3-complete : add a deferred second per-email identity
//   - model4-proof     : proven ownership before linking a second brand
//   - google-link      : proven ownership before linking a cold Google identity
//
// Each purpose gets its OWN cookie name so journeys can never read or clobber
// one another. Payloads carry only NON-secret routing facts (an email, a list
// of proven emails, a sub) — never a password, OTP, or token.

import "server-only"
import {
  signHandoff,
  verifyHandoff,
  type HandoffPurpose,
  type VerifyResult,
} from "@/lib/handoff-token"

/** Minutes — long enough for a person to read an email and type a code. */
export const JOURNEY_TTL_SECONDS = 10 * 60

const COOKIE_NAME: Record<HandoffPurpose, string> = {
  "model3-register": "__m3r_ho",
  "model3-complete": "__m3_ho",
  "model4-proof": "__m4_ho",
  "google-link": "__gl_proof_ho",
}

export function journeyCookieName(purpose: HandoffPurpose): string {
  return COOKIE_NAME[purpose]
}

function secret(): string {
  return process.env.AUTH0_SECRET ?? ""
}

/** Serialize a signed token for a Set-Cookie value. */
export function mintJourneyToken<T extends Record<string, unknown>>(
  purpose: HandoffPurpose,
  data: T,
): string {
  return signHandoff(purpose, data, secret())
}

/** Verify a raw cookie value for a specific purpose (fails closed). */
export function readJourneyToken<T extends Record<string, unknown>>(
  purpose: HandoffPurpose,
  raw: string | undefined | null,
): VerifyResult<T> {
  return verifyHandoff<T>(raw, purpose, secret(), {
    maxAgeMs: JOURNEY_TTL_SECONDS * 1000,
  })
}

/** Standard httpOnly cookie attributes for a journey handoff. */
export function journeyCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: JOURNEY_TTL_SECONDS,
  }
}
