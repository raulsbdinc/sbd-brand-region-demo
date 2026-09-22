// Unit tests for the PURE per-email pair activation planner (no framework, no
// network). Run with:  node --test lib/per-email-activation.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  planPerEmailActivation,
  eligibleActivationEmails,
  emailOnPerEmailIdentity,
  type PerEmailActivationContext,
} from "./per-email-activation.ts"
import {
  configuredConnectionKeys,
  type ConnectionKey,
  type CredentialBinding,
} from "./credential-model.ts"

const NAMES: Record<ConnectionKey, string | undefined> = {
  shared: "sbd-eu",
  "per-email": "sbd-per-email",
  dewalt: "sbd-dewalt",
  stanley: "sbd-stanley",
}
const ALL_KEYS = configuredConnectionKeys(NAMES)

const A = "primary@prorises.com"
const B = "secondary@prorises.com"

function brandBinding(email: string, brand: "dewalt" | "stanley"): CredentialBinding {
  return {
    id: `${brand}:${email}`,
    email,
    connectionKey: brand,
    auth0UserId: `auth0|${brand}-${email}`,
    useCase: "per-brand-password",
    brand,
  }
}
function perEmailBinding(email: string): CredentialBinding {
  return {
    id: `per-email:${email}`,
    email,
    connectionKey: "per-email",
    auth0UserId: `auth0|pe-${email}`,
    useCase: "per-email-password",
  }
}

function ctx(overrides: Partial<PerEmailActivationContext> = {}): PerEmailActivationContext {
  return {
    primaryEmail: A,
    secondaryEmail: B,
    verifiedEmails: [A, B],
    existingBindings: [brandBinding(A, "dewalt")], // the reproduced state
    backedPerEmailEmails: [],
    configuredKeys: ALL_KEYS,
    ...overrides,
  }
}

// --- The reproduced production state ---------------------------------------
test("activation: from per-brand primary + OTP-verified alias secondary → create BOTH per-email identities", () => {
  const plan = planPerEmailActivation(ctx())
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.createPrimary, true)
  assert.equal(plan.createSecondary, true)
  assert.equal(plan.alreadyActivated, false)
  assert.equal(plan.primaryEmail, A)
  assert.equal(plan.secondaryEmail, B)
})

test("activation: reverse order works the same (Stanley-first primary) — brand on primary never blocks", () => {
  const plan = planPerEmailActivation(ctx({ existingBindings: [brandBinding(A, "stanley")] }))
  assert.equal(plan.ok, true)
  assert.equal(plan.ok && plan.createPrimary, true)
  assert.equal(plan.ok && plan.createSecondary, true)
})

// --- Idempotency / partial retry -------------------------------------------
test("activation: primary already per-email backed → only create the secondary", () => {
  const plan = planPerEmailActivation(
    ctx({
      existingBindings: [brandBinding(A, "dewalt"), perEmailBinding(A)],
      backedPerEmailEmails: [A],
    }),
  )
  assert.equal(plan.ok && plan.createPrimary, false)
  assert.equal(plan.ok && plan.createSecondary, true)
  assert.equal(plan.ok && plan.alreadyActivated, false)
})

test("activation: BOTH already per-email backed → no-op, alreadyActivated", () => {
  const plan = planPerEmailActivation(
    ctx({
      existingBindings: [perEmailBinding(A), perEmailBinding(B)],
      backedPerEmailEmails: [A, B],
    }),
  )
  assert.equal(plan.ok && plan.createPrimary, false)
  assert.equal(plan.ok && plan.createSecondary, false)
  assert.equal(plan.ok && plan.alreadyActivated, true)
})

// --- Fail-closed rejections -------------------------------------------------
test("activation: per-email connection not configured → not-configured", () => {
  const plan = planPerEmailActivation(
    ctx({ configuredKeys: configuredConnectionKeys({ ...NAMES, "per-email": undefined }) }),
  )
  assert.equal(plan.ok, false)
  assert.equal(plan.ok === false && plan.reason, "not-configured")
})

test("activation: secondary not a verified owned email → secondary-not-eligible", () => {
  const plan = planPerEmailActivation(ctx({ verifiedEmails: [A] }))
  assert.equal(plan.ok, false)
  assert.equal(plan.ok === false && plan.reason, "secondary-not-eligible")
})

test("activation: primary not verified → primary-not-eligible", () => {
  const plan = planPerEmailActivation(ctx({ verifiedEmails: [B] }))
  assert.equal(plan.ok, false)
  assert.equal(plan.ok === false && plan.reason, "primary-not-eligible")
})

test("activation: secondary equals primary → same-email", () => {
  const plan = planPerEmailActivation(ctx({ secondaryEmail: A, verifiedEmails: [A] }))
  assert.equal(plan.ok, false)
  assert.equal(plan.ok === false && plan.reason, "same-email")
})

test("activation: secondary already carries a per-BRAND credential → conflict, secondary-not-eligible", () => {
  const plan = planPerEmailActivation(
    ctx({ existingBindings: [brandBinding(A, "dewalt"), brandBinding(B, "dewalt")] }),
  )
  assert.equal(plan.ok, false)
  assert.equal(plan.ok === false && plan.reason, "secondary-not-eligible")
})

test("activation: emails are normalized (casing/whitespace) before planning", () => {
  const plan = planPerEmailActivation(
    ctx({ primaryEmail: `  ${A.toUpperCase()} `, secondaryEmail: ` ${B.toUpperCase()}` }),
  )
  assert.equal(plan.ok, true)
  assert.equal(plan.ok && plan.primaryEmail, A)
  assert.equal(plan.ok && plan.secondaryEmail, B)
})

// --- Eligible-emails UI helper ---------------------------------------------
test("eligibleActivationEmails: verified alternate with no per-email password is offered", () => {
  const out = eligibleActivationEmails({
    primaryEmail: A,
    verifiedEmails: [A, B],
    backedPerEmailEmails: [],
  })
  assert.deepEqual(out, [B])
})

test("eligibleActivationEmails: excludes the primary and already-backed emails", () => {
  const out = eligibleActivationEmails({
    primaryEmail: A,
    verifiedEmails: [A, B, "third@prorises.com"],
    backedPerEmailEmails: [B],
  })
  assert.deepEqual(out, ["third@prorises.com"])
})

test("emailOnPerEmailIdentity: root signup identity uses the account email", () => {
  assert.equal(
    emailOnPerEmailIdentity({
      connection: "sbd-per-email",
      perEmailConnection: "sbd-per-email",
      provider: "auth0",
      identityUserId: "abc",
      accountUserId: "auth0|abc",
      accountEmail: "Primary@Example.com",
    }),
    "primary@example.com",
  )
})

test("emailOnPerEmailIdentity: a linked identity uses profileData, not the account email", () => {
  assert.equal(
    emailOnPerEmailIdentity({
      connection: "sbd-per-email",
      perEmailConnection: "sbd-per-email",
      provider: "auth0",
      identityUserId: "linked",
      profileEmail: "Second@Example.com",
      accountUserId: "auth0|abc",
      accountEmail: "primary@example.com",
    }),
    "second@example.com",
  )
})

test("emailOnPerEmailIdentity: ignores other connections and a root identity with no email", () => {
  assert.equal(
    emailOnPerEmailIdentity({
      connection: "sbd-dewalt",
      perEmailConnection: "sbd-per-email",
      provider: "auth0",
      identityUserId: "abc",
      accountUserId: "auth0|abc",
      accountEmail: "primary@example.com",
    }),
    null,
  )
  assert.equal(
    emailOnPerEmailIdentity({
      connection: "sbd-per-email",
      perEmailConnection: "sbd-per-email",
      provider: "auth0",
      identityUserId: "someone-else",
      accountUserId: "auth0|abc",
      accountEmail: "primary@example.com",
    }),
    null,
  )
})

test("eligibleActivationEmails: dedupes and normalizes casing", () => {
  const out = eligibleActivationEmails({
    primaryEmail: A.toUpperCase(),
    verifiedEmails: [A, B, B.toUpperCase(), ` ${B} `],
    backedPerEmailEmails: [],
  })
  assert.deepEqual(out, [B])
})
