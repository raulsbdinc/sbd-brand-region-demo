import { test } from "node:test"
import assert from "node:assert/strict"
import {
  evaluateAddEmailOwnership,
  planAddEmailOwnership,
  selectTransientEmailStubIds,
  addEmailRejectionCopy,
  type AddEmailCandidate,
} from "./add-email-ownership.ts"

// ============================================================================
// evaluateAddEmailOwnership — the canonical-id comparison core.
// ============================================================================

test("rejects when a DIFFERENT canonical customer owns the email", () => {
  const decision = evaluateAddEmailOwnership({
    email: "josem18519@mapsguy.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "auth0|C" }],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("allows when the email is unowned", () => {
  const decision = evaluateAddEmailOwnership({
    email: "brand-new@example.com",
    currentUserId: "auth0|A",
    owners: [],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("allows when the ONLY owner is the current canonical user (Model 4 / retry)", () => {
  const decision = evaluateAddEmailOwnership({
    email: "mine@example.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "auth0|A" }],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("rejects when the current user AND a foreign user both own it", () => {
  const decision = evaluateAddEmailOwnership({
    email: "shared@example.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "auth0|A" }, { canonicalUserId: "auth0|C" }],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("fails closed as unavailable when the directory lookup failed", () => {
  const decision = evaluateAddEmailOwnership({
    email: "x@example.com",
    currentUserId: "auth0|A",
    owners: [],
    lookupOk: false,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "unavailable")
})

test("fails closed as ambiguous when an owner has no canonical id", () => {
  const decision = evaluateAddEmailOwnership({
    email: "x@example.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "  " }],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "ambiguous")
})

// ============================================================================
// planAddEmailOwnership — candidate reduction (stub filtering + normalization).
// ============================================================================

const realAccount = (userId: string, emails: string[]): AddEmailCandidate => ({
  userId,
  ownedEmails: emails,
  hasRealIdentity: true,
})

test("different canonical owner is rejected from real candidates", () => {
  // Customer C owns josem18519@mapsguy.com with dewalt+stanley identities.
  const decision = planAddEmailOwnership({
    email: "josem18519@mapsguy.com",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|C", ["josem18519@mapsguy.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("same canonical owner is allowed (idempotent / Model 4 cross-brand)", () => {
  const decision = planAddEmailOwnership({
    email: "MINE@example.com",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|A", ["mine@example.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("email is matched case/space-insensitively (normalized)", () => {
  const decision = planAddEmailOwnership({
    email: "  Jose.M@Example.com ",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|C", ["jose.m@example.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("a transient passwordless stub for the target email is NOT an owner", () => {
  // The emailed-code step mints a bare `email` OTP stub for the typed address.
  // It must not count as a foreign owner and block a legitimate unowned add.
  const decision = planAddEmailOwnership({
    email: "brand-new@example.com",
    currentUserId: "auth0|A",
    candidates: [
      {
        userId: "auth0|stub",
        ownedEmails: ["brand-new@example.com"],
        hasRealIdentity: false,
      },
    ],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("an account that does not actually own the email is ignored", () => {
  const decision = planAddEmailOwnership({
    email: "target@example.com",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|C", ["someone-else@example.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

// ============================================================================
// selectTransientEmailStubIds — cleanup only ever removes the OTP artifact.
// ============================================================================

test("selects a pure passwordless stub whose root email is the target", () => {
  const ids = selectTransientEmailStubIds({
    email: "brand-new@example.com",
    candidates: [
      { userId: "auth0|stub", rootEmail: "brand-new@example.com", identityProviders: ["email"] },
    ],
  })
  assert.deepEqual(ids, ["auth0|stub"])
})

test("NEVER selects a real account (has a database/social identity)", () => {
  const ids = selectTransientEmailStubIds({
    email: "josem18519@mapsguy.com",
    candidates: [
      {
        userId: "auth0|C",
        rootEmail: "josem18519@mapsguy.com",
        identityProviders: ["auth0", "email"],
      },
    ],
  })
  assert.deepEqual(ids, [])
})

test("does not select a stub whose root email is a different address", () => {
  const ids = selectTransientEmailStubIds({
    email: "target@example.com",
    candidates: [
      { userId: "auth0|other", rootEmail: "other@example.com", identityProviders: ["email"] },
    ],
  })
  assert.deepEqual(ids, [])
})

// ============================================================================
// Rejection copy — the exact customer-facing string.
// ============================================================================

test("different-owner copy is the required customer string", () => {
  assert.equal(
    addEmailRejectionCopy("different-owner"),
    "This email is already used by another account and cannot be added here.",
  )
})
