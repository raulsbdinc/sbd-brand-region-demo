// TOTP ENROLMENT HELPERS (server-only)
// ====================================
// Thin wrapper over the well-known `otpauth` library so the enrolment routes
// never hand-roll the crypto. We use it for three things:
//
//   1. generate a random base32 secret,
//   2. build an otpauth:// URI labelled for THIS brand + market (so the entry
//      in the authenticator app reads as the brand, not "Auth0"),
//   3. verify a 6-digit code against the secret, server-side, before we ever
//      register the factor with Auth0.
//
// Standard authenticator parameters: SHA1, 6 digits, 30-second step. We accept
// one step either side (`window: 1`) for clock drift between the phone and the
// server, which is the conventional tolerance.

import "server-only"
import { Secret, TOTP } from "otpauth"
import { SITE_BRAND_INFO, SITE_COUNTRY } from "@/lib/site"

/** Standard authenticator settings shared by URI generation and verification. */
const TOTP_CONFIG = {
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
}

/**
 * The issuer shown in the authenticator app, e.g. "DeWalt France". Derived from
 * this deployment's brand + market so a scanned entry is recognisably ours.
 */
export function totpIssuer(): string {
  return `${SITE_BRAND_INFO.name} ${SITE_COUNTRY.name}`
}

export interface TotpEnrolmentStart {
  /** base32 secret, grouped for legible manual entry (spaces are ignored on scan). */
  secret: string
  /** Compact base32 secret with no spaces — what we store and register. */
  rawSecret: string
  /** otpauth:// URI to render as a QR code. */
  uri: string
  issuer: string
  account: string
}

/**
 * Generate a fresh TOTP secret and the matching otpauth URI for `account`
 * (normally the user's email), labelled for this brand + market.
 */
export function createTotpEnrolment(account: string): TotpEnrolmentStart {
  const secret = new Secret({ size: 20 }) // 160-bit, the RFC 6238 recommendation
  const issuer = totpIssuer()
  const totp = new TOTP({ ...TOTP_CONFIG, issuer, label: account, secret })
  const raw = secret.base32
  return {
    rawSecret: raw,
    // Group into 4-char blocks so it can be typed by hand without losing place.
    secret: raw.replace(/(.{4})/g, "$1 ").trim(),
    uri: totp.toString(),
    issuer,
    account,
  }
}

/**
 * Verify a user-entered code against a stored base32 secret. Returns true only
 * for the current 30s step or one step either side. `otpauth` returns the delta
 * (0, ±1) on a match and null on no match.
 */
export function verifyTotp(rawSecret: string, code: string): boolean {
  const token = code.replace(/\D/g, "")
  if (token.length !== TOTP_CONFIG.digits) return false
  try {
    const totp = new TOTP({
      ...TOTP_CONFIG,
      issuer: totpIssuer(),
      secret: Secret.fromBase32(rawSecret),
    })
    const delta = totp.validate({ token, window: 1 })
    return delta !== null
  } catch {
    return false
  }
}
