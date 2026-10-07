// Regression tests for CIAM-20 (passcode start must stop before any send when
// the email has no account for this brand, and report provider failures
// truthfully) and CIAM-21 (any verified email of the same canonical customer
// signs in to an already enrolled brand with that brand's one credential).
// Run with: node --test lib/ciam-20-21.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  configuredConnectionKeys,
  resolveCredentialFromCandidates,
  verifiedLoginEmailsFor,
  type CandidateAccount,
  type ConnectionKey,
  type CredentialBinding,
} from "./credential-model.ts"
import {
  PASSCODE_SEND_TIMEOUT_MS,
  gateBrandPasscodeStart,
  passcodeSendFailure,
} from "./passcode-start-outcome.ts"

const KEYS = configuredConnectionKeys({
  shared: "sbd-eu",
  "per-email": "sbd-per-email",
  dewalt: "sbd-dewalt",
  stanley: "sbd-stanley",
} as Record<ConnectionKey, string | undefined>)

const A = "primary-a@example.com"
const B = "secondary-b@example.com"
const CANONICAL = "auth0|canonical"

function brandBinding(brand: "dewalt" | "stanley", email: string, userId: string): CredentialBinding {
  return {
    id: `${brand}-${userId}`,
    email,
    connectionKey: brand,
    auth0UserId: userId,
    useCase: "per-brand-password",
    brand,
  } as CredentialBinding
}

/**
 * The CIAM-21 reverse case: DeWalt UK enrolled with primary A, secondary B
 * added and verified, then Stanley UK enrolled using B. One canonical record.
 */
function reverseCaseAccount(overrides: Partial<CandidateAccount> = {}): CandidateAccount {
  return {
    accountId: CANONICAL,
    bindings: [
      brandBinding("dewalt", A, "auth0|dw-a"),
      brandBinding("stanley", B, "auth0|st-b"),
    ],
    identities: [
      { connectionKey: "dewalt", userId: "auth0|dw-a" },
      { connectionKey: "stanley", userId: "auth0|st-b" },
      { connectionKey: null, userId: "email|b" },
    ],
    verifiedLoginEmails: [A, B],
    ...overrides,
  }
}

function resolve(email: string, siteBrand: "dewalt" | "stanley", candidates: CandidateAccount[]) {
  return resolveCredentialFromCandidates({ email, siteBrand, candidates, configuredKeys: KEYS })
}

// --- CIAM-21: verified aliases --------------------------------------------

test("CIAM-21 reverse case: primary A resolves to Stanley's one credential (enrolled via B)", () => {
  const res = resolve(A, "stanley", [reverseCaseAccount()])
  assert.equal(res.ok && res.kind, "resolved")
  assert.ok(res.ok && res.kind === "resolved")
  assert.equal(res.connectionKey, "stanley")
  assert.equal(res.binding.email, B, "username sent to the realm is Stanley's own login email")
  assert.equal(res.binding.auth0UserId, "auth0|st-b")
})

test("CIAM-21 reverse case: secondary B resolves to Stanley by exact binding", () => {
  const res = resolve(B, "stanley", [reverseCaseAccount()])
  assert.ok(res.ok && res.kind === "resolved")
  assert.equal(res.connectionKey, "stanley")
  assert.equal(res.binding.auth0UserId, "auth0|st-b")
})

test("CIAM-21: secondary B resolves to DeWalt's one credential (enrolled via A)", () => {
  const res = resolve(B, "dewalt", [reverseCaseAccount()])
  assert.ok(res.ok && res.kind === "resolved")
  assert.equal(res.connectionKey, "dewalt")
  assert.equal(res.binding.email, A)
})

test("CIAM-21: email case does not matter", () => {
  const res = resolve("Primary-A@Example.COM", "stanley", [reverseCaseAccount()])
  assert.ok(res.ok && res.kind === "resolved")
  assert.equal(res.connectionKey, "stanley")
})

test("CIAM-21: an alias never grants a brand the customer is not enrolled in", () => {
  const dewaltOnly = reverseCaseAccount({
    bindings: [brandBinding("dewalt", A, "auth0|dw-a")],
    identities: [{ connectionKey: "dewalt", userId: "auth0|dw-a" }],
  })
  for (const email of [A, B]) {
    const res = resolve(email, "stanley", [dewaltOnly])
    assert.notEqual(res.ok && res.kind, "resolved", `${email} must not resolve on Stanley`)
  }
})

test("CIAM-21: an UNVERIFIED or removed alias does not resolve", () => {
  const res = resolve(B, "dewalt", [
    reverseCaseAccount({
      bindings: [brandBinding("dewalt", A, "auth0|dw-a")],
      identities: [{ connectionKey: "dewalt", userId: "auth0|dw-a" }],
      verifiedLoginEmails: [A],
    }),
  ])
  assert.notEqual(res.ok && res.kind, "resolved")
})

test("CIAM-21: a binding not backed by a real linked identity is never used via an alias", () => {
  const res = resolve(A, "stanley", [
    reverseCaseAccount({ identities: [{ connectionKey: "dewalt", userId: "auth0|dw-a" }] }),
  ])
  assert.notEqual(res.ok && res.kind, "resolved")
})

test("CIAM-21: an email claimed as verified by two DIFFERENT customers fails closed", () => {
  const other: CandidateAccount = {
    accountId: "auth0|other",
    bindings: [brandBinding("stanley", "someone@example.com", "auth0|st-other")],
    identities: [{ connectionKey: "stanley", userId: "auth0|st-other" }],
    verifiedLoginEmails: ["someone@example.com", A],
  }
  const res = resolve(A, "stanley", [reverseCaseAccount(), other])
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.reason, "ambiguous")
})

test("CIAM-21: another customer's alias never resolves to this customer's credential", () => {
  const other: CandidateAccount = {
    accountId: "auth0|other",
    bindings: [],
    identities: [],
    verifiedLoginEmails: ["intruder@example.com"],
  }
  const res = resolve("intruder@example.com", "stanley", [reverseCaseAccount(), other])
  assert.notEqual(res.ok && res.kind, "resolved")
})

test("CIAM-21: verifiedLoginEmailsFor owns only verified root and verified linked emails", () => {
  const emails = verifiedLoginEmailsFor({
    rootEmail: "Primary-A@Example.com",
    rootEmailVerified: true,
    bindingCount: 2,
    identities: [
      { provider: "auth0", profileEmail: "primary-a@example.com", profileEmailVerified: true },
      { provider: "email", profileEmail: "Secondary-B@Example.com" },
      { provider: "auth0", profileEmail: "unverified@example.com", profileEmailVerified: false },
    ],
  })
  assert.deepEqual(emails.sort(), [A, B].sort())
})

test("CIAM-21: an unverified root email is not a login identifier", () => {
  const emails = verifiedLoginEmailsFor({
    rootEmail: A,
    rootEmailVerified: false,
    bindingCount: 1,
    identities: [{ provider: "auth0", profileEmail: A, profileEmailVerified: false }],
  })
  assert.deepEqual(emails, [])
})

test("CIAM-21: a standalone passwordless stub owns no login emails", () => {
  const emails = verifiedLoginEmailsFor({
    rootEmail: B,
    rootEmailVerified: true,
    bindingCount: 0,
    identities: [{ provider: "email", profileEmail: B }],
  })
  assert.deepEqual(emails, [])
})

// --- CIAM-20: passcode start gate -----------------------------------------

test("CIAM-20: a never-registered email stops before any send", () => {
  assert.equal(gateBrandPasscodeStart({ resolutionKind: "shared-default", siteBrand: "stanley" }), "not-registered")
})

test("CIAM-20: a customer enrolled only in the other brand stops before any send", () => {
  assert.equal(
    gateBrandPasscodeStart({ resolutionKind: "resolved", resolvedConnectionKey: "dewalt", siteBrand: "stanley" }),
    "not-registered",
  )
})

test("CIAM-20: the wrong region (lookup on this tenant finds nothing) stops before any send", () => {
  const wrongRegion = resolve(A, "stanley", [])
  assert.equal(wrongRegion.ok && wrongRegion.kind, "shared-default")
  assert.equal(gateBrandPasscodeStart({ resolutionKind: "shared-default", siteBrand: "stanley" }), "not-registered")
})

test("CIAM-20: an enrolled customer (exact or verified alias) proceeds", () => {
  for (const email of [A, B]) {
    const res = resolve(email, "stanley", [reverseCaseAccount()])
    assert.ok(res.ok && res.kind === "resolved")
    assert.equal(
      gateBrandPasscodeStart({ resolutionKind: "resolved", resolvedConnectionKey: res.connectionKey, siteBrand: "stanley" }),
      "proceed",
    )
  }
})

test("CIAM-20: a failed lookup is unavailable, never not-registered or code-sent", () => {
  assert.equal(gateBrandPasscodeStart({ resolutionKind: "unavailable", siteBrand: "dewalt" }), "unavailable")
})

test("CIAM-20: a conflicting email fails closed", () => {
  assert.equal(gateBrandPasscodeStart({ resolutionKind: "ambiguous", siteBrand: "dewalt" }), "conflict")
})

test("CIAM-20: provider 429 stays 429; other send failures and timeouts are 503", () => {
  assert.deepEqual(passcodeSendFailure({ status: 429 }), { status: 429, code: "throttled" })
  assert.deepEqual(passcodeSendFailure({ status: 500 }), { status: 503, code: "provider-unavailable" })
  assert.deepEqual(passcodeSendFailure({ status: 400 }), { status: 503, code: "provider-unavailable" })
  assert.deepEqual(passcodeSendFailure(new DOMException("timed out", "TimeoutError")), {
    status: 503,
    code: "provider-unavailable",
  })
  assert.deepEqual(passcodeSendFailure(null), { status: 503, code: "provider-unavailable" })
})

test("CIAM-20: the passcode send is bounded well under a minute", () => {
  assert.ok(PASSCODE_SEND_TIMEOUT_MS > 0 && PASSCODE_SEND_TIMEOUT_MS <= 10_000)
})
