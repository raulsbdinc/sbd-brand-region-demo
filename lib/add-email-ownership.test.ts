import { test } from "node:test"
import assert from "node:assert/strict"
import {
  evaluateAddEmailOwnership,
  planAddEmailOwnership,
  selectTransientEmailStubIds,
  collectIdentityOwnedEmails,
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

// ============================================================================
// collectIdentityOwnedEmails — every identity's email counts as owned, incl.
// an UNVERIFIED social profileData email (the linked-Google discovery gap).
// ============================================================================

test("collects a linked Google identity's profileData email even when unverified", () => {
  // Canonical A: root email dedes10491@mediseat.com, with a linked Google
  // identity carrying raul.sbdinc@gmail.com. The social profileData may omit or
  // stringify email_verified — ownership must not depend on that flag.
  const emails = collectIdentityOwnedEmails({
    email: "dedes10491@mediseat.com",
    identities: [
      { profileData: {} }, // primary DB identity, no email in profileData
      { profileData: { email: "raul.sbdinc@gmail.com" } }, // linked Google, no email_verified
    ],
  })
  assert.ok(emails.includes("dedes10491@mediseat.com"))
  assert.ok(emails.includes("raul.sbdinc@gmail.com"))
})

test("collects an identity's top-level email and normalizes casing/space", () => {
  const emails = collectIdentityOwnedEmails({
    email: "  Root@Example.com ",
    identities: [{ email: "Alt@Example.com", profileData: { email: "  Third@Example.com" } }],
  })
  assert.deepEqual(
    [...emails].sort(),
    ["alt@example.com", "root@example.com", "third@example.com"].sort(),
  )
})

test("tolerates missing/empty identities and emails", () => {
  assert.deepEqual(collectIdentityOwnedEmails({}), [])
  assert.deepEqual(collectIdentityOwnedEmails({ email: "", identities: null }), [])
  assert.deepEqual(
    collectIdentityOwnedEmails({ identities: [{ profileData: null }, {}] }),
    [],
  )
})

// ============================================================================
// FOREIGN LINKED-GOOGLE OWNERSHIP — the reported preview defect, end to end
// through the pure reduction with ownedEmails built the way the server bridge
// now builds them (identity emails included).
// ============================================================================

test("rejects adding a Gmail owned ONLY via a foreign account's linked Google identity", () => {
  // Signed in as canonical B (auth0|B). The Gmail raul.sbdinc@gmail.com is a
  // linked Google identity on a DIFFERENT canonical A (auth0|A) — its root email
  // is dedes10491@mediseat.com, so /users-by-email(Gmail) never surfaced A and
  // the add was wrongly allowed. With identity emails included in ownedEmails,
  // A is a real owner of the Gmail and the add must be rejected.
  const foreignA: AddEmailCandidate = {
    userId: "auth0|A",
    ownedEmails: collectIdentityOwnedEmails({
      email: "dedes10491@mediseat.com",
      identities: [
        { profileData: {} },
        { profileData: { email: "raul.sbdinc@gmail.com" } },
      ],
    }),
    hasRealIdentity: true,
  }
  // The transient passwordless OTP stub the code step minted for the Gmail.
  const stub: AddEmailCandidate = {
    userId: "auth0|stub",
    ownedEmails: ["raul.sbdinc@gmail.com"],
    hasRealIdentity: false,
  }

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: [foreignA, stub],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("Model 4 no-regression: same canonical owner via its own linked identity is allowed", () => {
  // The email lives on the CURRENT account's own linked identity — adding/linking
  // a new brand credential for it must still be allowed.
  const selfOwned: AddEmailCandidate = {
    userId: "auth0|B",
    ownedEmails: collectIdentityOwnedEmails({
      email: "wacev92852@mapsguy.com",
      identities: [{ profileData: { email: "raul.sbdinc@gmail.com" } }],
    }),
    hasRealIdentity: true,
  }
  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: [selfOwned],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})
