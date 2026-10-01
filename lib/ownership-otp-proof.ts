// OWNERSHIP OTP PROOF — PRESERVING (pure + injected IO, tested)
// =============================================================
// Shared by:
//   - Model 4 second-brand enrollment (/api/registration/brand/proof[/start])
//   - EU brand passcode sign-in resend (/api/signin/passcode/start)
//
// Mailbox proof goes out on the passwordless "email" connection. Consuming the
// code can make Auth0 mint a standalone `email|…` account. Nothing here, or in
// any injected dependency, can delete or unlink a record:
//
//   - verified sub == fresh primary            → already linked → proven.
//   - verified sub is a non-`email|` account   → another owner (auth0|, sms|,
//     google-oauth2|…) → fail closed, untouched.
//   - `email|X` listed in the signed pre-send snapshot → pre-existing standalone
//     email-only customer → fail closed, untouched.
//   - `email|X` NOT in the snapshot, standalone, exactly its one passwordless
//     identity on this address → created by THIS challenge → linked to the SAME
//     primary. A failed link RETAINS the stub and fails closed.
//
// RESEND: the snapshot (and its expiry anchor `iat`) is carried forward from a
// still-valid signed handoff for the same flow + email + brand (+ primary), so a
// stub minted by the FIRST send is still recognised as this challenge's own. A
// resend never takes a newer snapshot over an older valid one, so it can only
// keep pre-existing accounts classified as pre-existing — it never reclassifies
// one as fresh. The window stays bounded by the ORIGINAL send's TTL.

import {
  decodeHandoffWithKey,
  type HandoffCodecPayload,
} from "./passcode-handoff-codec.ts"
import {
  planBrandPasscodeVerify,
  type BrandProofFailReason,
  type PasswordlessStub,
} from "./brand-passcode-verify.ts"

export const BRAND_ENROLL_PROOF_FLOW = "brand-enroll-proof"

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Snapshot + expiry anchor to carry into a newly minted handoff. Returns the
 * prior values when `priorRaw` is a valid (signed, unexpired) handoff for the
 * exact same flow/email/brand/primary; otherwise null (caller snapshots fresh).
 */
export function carryForwardProofSnapshot(params: {
  priorRaw: string | undefined
  key: string
  flow: string
  email: string
  brand: string
  primaryUserId?: string
  now?: number
}): { iat: number; preExistingPasswordlessSubs: string[] } | null {
  const prior = decodeHandoffWithKey(params.priorRaw, params.key, params.now)
  if (!prior) return null
  if (prior.flow !== params.flow) return null
  if (!prior.email || norm(prior.email) !== norm(params.email)) return null
  if (!prior.brand || prior.brand !== params.brand) return null
  if ((prior.primaryUserId ?? "") !== (params.primaryUserId ?? "")) return null
  if (!Array.isArray(prior.preExistingPasswordlessSubs)) return null
  return { iat: prior.iat, preExistingPasswordlessSubs: prior.preExistingPasswordlessSubs }
}

export interface EnrollmentOtpProofDeps {
  /** Consumes the single-use code at the IdP; resolves the verified sub. */
  verifyOtp(email: string, code: string): Promise<{ sub: string }>
  /**
   * FRESH re-resolution after the code is consumed: the one existing account
   * that owns `email` (unique, verified). Null when missing/ambiguous/unavailable.
   */
  resolvePrimary(email: string): Promise<string | null>
  readStub(sub: string): Promise<PasswordlessStub | null>
  /** Link `email|stubUserId` under `primary`. The ONLY mutation available. */
  linkStub(primary: string, stubUserId: string): Promise<void>
}

export type EnrollmentOtpProofFailReason =
  | Exclude<BrandProofFailReason, "no-canonical" | "session-failed">
  | "primary-changed"

export type EnrollmentOtpProofResult =
  | { ok: true; primaryUserId: string; linkedNewStub: boolean; codeConsumed: true }
  | { ok: false; reason: EnrollmentOtpProofFailReason; codeConsumed: boolean }

/**
 * Prove mailbox ownership for a second-brand enrollment bound to
 * `expected.primaryUserId`. Never opens a session; the caller enrolls only on ok.
 */
export async function proveEnrollmentOwnershipOtp(
  input: {
    rawHandoff: string | undefined
    key: string
    code: string
    siteBrand: string
    expected: { email: string; primaryUserId: string }
    now?: number
  },
  deps: EnrollmentOtpProofDeps,
): Promise<EnrollmentOtpProofResult> {
  const h: HandoffCodecPayload | null = decodeHandoffWithKey(input.rawHandoff, input.key, input.now)
  // Every binding check happens BEFORE the code is consumed, so a stale,
  // forged or foreign handoff never burns the customer's code or reads records.
  if (
    !h ||
    h.flow !== BRAND_ENROLL_PROOF_FLOW ||
    !h.email ||
    !input.code ||
    norm(h.email) !== norm(input.expected.email) ||
    !h.primaryUserId ||
    h.primaryUserId !== input.expected.primaryUserId
  ) {
    return { ok: false, reason: "bad-handoff", codeConsumed: false }
  }
  if (!h.brand || h.brand !== input.siteBrand) {
    return { ok: false, reason: "wrong-brand", codeConsumed: false }
  }

  let verifiedSub: string
  try {
    verifiedSub = (await deps.verifyOtp(h.email, input.code)).sub
  } catch {
    return { ok: false, reason: "bad-code", codeConsumed: false }
  }

  const fresh = await deps.resolvePrimary(h.email).catch(() => null)
  if (!fresh || fresh !== h.primaryUserId) {
    return { ok: false, reason: "primary-changed", codeConsumed: true }
  }

  const pre = h.preExistingPasswordlessSubs
  const needsStub =
    verifiedSub !== fresh &&
    verifiedSub.startsWith("email|") &&
    Array.isArray(pre) &&
    !pre.includes(verifiedSub)
  const stub = needsStub ? await deps.readStub(verifiedSub).catch(() => null) : null

  const decision = planBrandPasscodeVerify({
    email: h.email,
    canonical: fresh,
    verifiedSub,
    preExistingPasswordlessSubs: pre,
    stub,
  })
  if (decision.kind === "fail") {
    const reason = decision.reason === "no-canonical" ? "primary-changed" : decision.reason
    return { ok: false, reason: reason as EnrollmentOtpProofFailReason, codeConsumed: true }
  }

  if (decision.kind === "link-new-stub") {
    try {
      await deps.linkStub(decision.canonical, decision.stubUserId)
    } catch {
      return { ok: false, reason: "link-failed", codeConsumed: true }
    }
    return { ok: true, primaryUserId: fresh, linkedNewStub: true, codeConsumed: true }
  }
  return { ok: true, primaryUserId: fresh, linkedNewStub: false, codeConsumed: true }
}
