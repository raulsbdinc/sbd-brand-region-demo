// BRAND PASSCODE VERIFY — PRESERVING STUB HANDLING (pure + injected IO, tested)
// ============================================================================
// EU brand (Model 4) passcode codes go out on the passwordless "email"
// connection as MAILBOX PROOF (the tenant rejects native DB OTP on the brand
// connections). Consuming such a code can make Auth0 mint a standalone
// `email|…` account. This module decides what happens next WITHOUT EVER
// DELETING OR TRANSFERRING ANY EXISTING RECORD:
//
//   - verified sub == brand canonical  → the email identity is already linked
//     to that canonical → open the canonical session.
//   - verified sub is some OTHER primary (auth0|…, google-oauth2|…) → the
//     address belongs to another owner → fail closed, no session, no change.
//   - verified sub is `email|X` that was in the pre-send snapshot → a
//     pre-existing standalone email-only customer → fail closed, untouched.
//   - pre-send snapshot unavailable → nothing provably new → fail closed.
//   - verified sub is `email|X`, NOT in the snapshot, standalone with exactly
//     its one passwordless identity on the typed address → a provably NEW
//     unowned stub minted by THIS challenge → link it to the canonical, then
//     open the canonical session. If linking fails, the stub is RETAINED (no
//     delete) and the attempt fails closed.
//
// The canonical is always re-resolved fresh, after the code is consumed, by the
// caller-supplied brand resolver (binding + backing identity, exactly one owner).
// There is deliberately NO delete dependency in this module.

import {
  decodeHandoffWithKey,
  type HandoffCodecPayload,
} from "./passcode-handoff-codec.ts"

export interface PasswordlessStub {
  userId: string
  rootEmail: string
  identities: { provider: string; userId: string }[]
}

export type BrandProofDecision =
  | { kind: "session"; canonical: string }
  | { kind: "link-new-stub"; canonical: string; stubUserId: string }
  | { kind: "fail"; reason: BrandProofFailReason }

export type BrandProofFailReason =
  | "bad-handoff"
  | "wrong-brand"
  | "bad-code"
  | "no-canonical"
  | "owned-elsewhere"
  | "snapshot-unavailable"
  | "pre-existing-passwordless"
  | "not-provably-new"
  | "link-failed"
  | "session-failed"

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Every passwordless account sub that already exists for `email`. Taken BEFORE
 * the challenge is sent and carried in the signed handoff.
 */
export function snapshotPasswordlessSubs(
  users: { userId: string; identities: { provider: string; userId: string }[] }[],
): string[] {
  const subs = new Set<string>()
  for (const u of users) {
    if (!u.userId) continue
    if (u.userId.startsWith("email|")) subs.add(u.userId)
    for (const id of u.identities) {
      if (id.provider === "email" && id.userId) subs.add(`email|${id.userId}`)
    }
  }
  return [...subs].sort()
}

export function planBrandPasscodeVerify(params: {
  email: string
  canonical: string | null
  verifiedSub: string
  preExistingPasswordlessSubs: string[] | null | undefined
  stub: PasswordlessStub | null
}): BrandProofDecision {
  const { canonical, verifiedSub } = params
  if (!canonical) return { kind: "fail", reason: "no-canonical" }
  if (verifiedSub === canonical) return { kind: "session", canonical }
  if (!verifiedSub.startsWith("email|")) return { kind: "fail", reason: "owned-elsewhere" }

  const pre = params.preExistingPasswordlessSubs
  if (!Array.isArray(pre)) return { kind: "fail", reason: "snapshot-unavailable" }
  if (pre.includes(verifiedSub)) return { kind: "fail", reason: "pre-existing-passwordless" }

  const stubUserId = verifiedSub.slice("email|".length)
  const stub = params.stub
  const provablyNew =
    !!stub &&
    stub.userId === verifiedSub &&
    norm(stub.rootEmail) === norm(params.email) &&
    stub.identities.length === 1 &&
    stub.identities[0].provider === "email" &&
    stub.identities[0].userId === stubUserId
  if (!provablyNew) return { kind: "fail", reason: "not-provably-new" }

  return { kind: "link-new-stub", canonical, stubUserId }
}

export interface BrandPasscodeVerifyDeps {
  /** Consumes the single-use code at the IdP; resolves the verified sub. */
  verifyOtp(email: string, code: string): Promise<{ sub: string }>
  /** Fresh server-side brand-canonical resolution (exactly one enrolled owner). */
  resolveCanonical(email: string): Promise<string | null>
  /** Read the account at `sub`; null when it cannot be read. */
  readStub(sub: string): Promise<PasswordlessStub | null>
  /** Link the passwordless identity `email|stubUserId` under `canonical`. */
  linkStub(canonical: string, stubUserId: string): Promise<void>
  /** Mint the canonical's session cookie value. */
  mintSession(canonical: string): Promise<string | null>
}

export type BrandPasscodeVerifyResult =
  | { ok: true; canonical: string; cookieValue: string; linkedNewStub: boolean }
  | { ok: false; reason: BrandProofFailReason }

export async function completeBrandPasscodeVerify(
  input: { rawHandoff: string | undefined; key: string; code: string; siteBrand: string; now?: number },
  deps: BrandPasscodeVerifyDeps,
): Promise<BrandPasscodeVerifyResult> {
  const handoff: HandoffCodecPayload | null = decodeHandoffWithKey(input.rawHandoff, input.key, input.now)
  if (!handoff || handoff.flow !== "brand-proof" || !handoff.email || !input.code) {
    return { ok: false, reason: "bad-handoff" }
  }
  // Checked BEFORE the code is consumed: a handoff minted by another brand's
  // storefront must not burn the customer's code or touch any record.
  if (!handoff.brand || handoff.brand !== input.siteBrand) {
    return { ok: false, reason: "wrong-brand" }
  }

  let verifiedSub: string
  try {
    verifiedSub = (await deps.verifyOtp(handoff.email, input.code)).sub
  } catch {
    return { ok: false, reason: "bad-code" }
  }

  const canonical = await deps.resolveCanonical(handoff.email).catch(() => null)
  const needsStub =
    !!canonical &&
    verifiedSub !== canonical &&
    verifiedSub.startsWith("email|") &&
    Array.isArray(handoff.preExistingPasswordlessSubs) &&
    !handoff.preExistingPasswordlessSubs.includes(verifiedSub)
  const stub = needsStub ? await deps.readStub(verifiedSub).catch(() => null) : null

  const decision = planBrandPasscodeVerify({
    email: handoff.email,
    canonical,
    verifiedSub,
    preExistingPasswordlessSubs: handoff.preExistingPasswordlessSubs,
    stub,
  })
  if (decision.kind === "fail") return { ok: false, reason: decision.reason }

  let linkedNewStub = false
  if (decision.kind === "link-new-stub") {
    try {
      await deps.linkStub(decision.canonical, decision.stubUserId)
      linkedNewStub = true
    } catch {
      return { ok: false, reason: "link-failed" }
    }
  }

  const cookieValue = await deps.mintSession(decision.canonical).catch(() => null)
  if (!cookieValue) return { ok: false, reason: "session-failed" }
  return { ok: true, canonical: decision.canonical, cookieValue, linkedNewStub }
}
