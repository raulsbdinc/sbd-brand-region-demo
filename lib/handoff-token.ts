// SIGNED, SINGLE-PURPOSE HANDOFF TOKEN — PURE CODEC
// =================================================
// Several journeys hand a small, server-minted fact from one request to a later
// one WITHOUT trusting the browser with it: the Model-3 registration-completion
// journey, the Model-4 cross-brand ownership proof, and the suggested Google
// account-link verification. Each stashes an opaque token in a short-lived
// httpOnly cookie. This module is the FRAMEWORK-FREE codec for those tokens:
// it signs a JSON payload with an HMAC (so the browser can neither forge nor
// swap fields), stamps a mint time, and on the way back verifies the signature,
// the expiry, AND the single declared `purpose` — a token minted for one
// journey can never be replayed into another.
//
// It takes the secret as a PARAMETER (never reads env) and is not server-only,
// so every rule is unit-testable. The thin server wrappers (see the routes)
// supply process.env.AUTH0_SECRET and do the cookie I/O.

import { createHmac, timingSafeEqual } from "node:crypto"

/** Every handoff purpose in the app. A token is bound to exactly one. */
export type HandoffPurpose =
  | "model3-register" // ownership proof carried across the signed-out Model-3 sign-up
  | "model3-complete" // add a second per-email identity to a Model-3 account
  | "model4-proof" // proven ownership before linking a second brand
  | "google-link" // proven ownership before linking a cold Google identity

/** The envelope every token carries. Callers extend `data` with journey fields. */
export interface HandoffEnvelope<T extends Record<string, unknown>> {
  purpose: HandoffPurpose
  /** Epoch ms the token was minted (defence-in-depth expiry). */
  iat: number
  data: T
}

export type VerifyFailure =
  | "missing"
  | "malformed"
  | "bad-signature"
  | "expired"
  | "purpose-mismatch"

export type VerifyResult<T extends Record<string, unknown>> =
  | { ok: true; data: T; iat: number }
  | { ok: false; reason: VerifyFailure }

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

/** Encode + sign a handoff token for a Set-Cookie value. */
export function signHandoff<T extends Record<string, unknown>>(
  purpose: HandoffPurpose,
  data: T,
  secret: string,
  now: number = Date.now(),
): string {
  const envelope: HandoffEnvelope<T> = { purpose, iat: now, data }
  const body = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
  return `${body}.${sign(body, secret)}`
}

/**
 * Verify + decode a handoff token. Returns the payload only when the signature
 * matches, the token has not expired, AND the declared purpose is exactly the
 * one expected. Fails CLOSED (never throws) with a specific reason otherwise.
 */
export function verifyHandoff<T extends Record<string, unknown>>(
  raw: string | undefined | null,
  expectedPurpose: HandoffPurpose,
  secret: string,
  opts: { maxAgeMs: number; now?: number } = { maxAgeMs: 5 * 60 * 1000 },
): VerifyResult<T> {
  if (!raw) return { ok: false, reason: "missing" }
  if (!secret) return { ok: false, reason: "bad-signature" }

  const dot = raw.lastIndexOf(".")
  if (dot <= 0) return { ok: false, reason: "malformed" }

  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = sign(body, secret)

  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" }
  }

  let envelope: HandoffEnvelope<T>
  try {
    envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HandoffEnvelope<T>
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (
    !envelope ||
    typeof envelope !== "object" ||
    typeof envelope.iat !== "number" ||
    typeof envelope.purpose !== "string" ||
    typeof envelope.data !== "object" ||
    envelope.data === null
  ) {
    return { ok: false, reason: "malformed" }
  }

  if (envelope.purpose !== expectedPurpose) {
    return { ok: false, reason: "purpose-mismatch" }
  }

  const now = opts.now ?? Date.now()
  if (now - envelope.iat > opts.maxAgeMs) {
    return { ok: false, reason: "expired" }
  }

  return { ok: true, data: envelope.data, iat: envelope.iat }
}
