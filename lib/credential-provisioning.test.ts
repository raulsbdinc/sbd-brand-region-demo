// Unit tests for the PURE provisioning model (no framework, no network).
// Run with:  node --test lib/credential-provisioning.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import { configuredConnectionKeys, type ConnectionKey, type CredentialBinding } from "./credential-model.ts"
import {
  appendCredentialBinding,
  brandConnectionKey,
  buildCredentialBinding,
  computeAddPasswordAvailability,
  isProvisionIntent,
  resolveProvisioning,
  type ProvisioningContext,
} from "./credential-provisioning.ts"

const NAMES: Record<ConnectionKey, string | undefined> = {
  shared: "sbd-eu",
  "per-email": "sbd-per-email",
  dewalt: "sbd-dewalt",
  stanley: "sbd-stanley",
}
const ALL_KEYS = configuredConnectionKeys(NAMES)

function ctx(overrides: Partial<ProvisioningContext> = {}): ProvisioningContext {
  return {
    siteBrand: "dewalt",
    verifiedEmails: ["primary@example.com", "alt@example.com"],
    primaryEmail: "primary@example.com",
    existingBindings: [],
    configuredKeys: ALL_KEYS,
    ...overrides,
  }
}

function perEmailBinding(email: string): CredentialBinding {
  return {
    id: `per-email:auth0|pe-${email}`,
    email,
    connectionKey: "per-email",
    auth0UserId: `auth0|pe-${email}`,
    useCase: "per-email-password",
  }
}

function brandBinding(email: string, brand: "dewalt" | "stanley"): CredentialBinding {
  return {
    id: `${brand}:auth0|${brand}-${email}`,
    email,
    connectionKey: brand,
    auth0UserId: `auth0|${brand}-${email}`,
    useCase: "per-brand-password",
    brand,
  }
}

// --- 1. Intent + brand-key guards ------------------------------------------
test("isProvisionIntent only accepts the two allow-listed intents", () => {
  assert.equal(isProvisionIntent("another-email"), true)
  assert.equal(isProvisionIntent("this-brand"), true)
  assert.equal(isProvisionIntent("shared"), false)
  assert.equal(isProvisionIntent("per-email"), false)
  assert.equal(isProvisionIntent(""), false)
  assert.equal(isProvisionIntent(null), false)
})

test("brandConnectionKey maps only DeWalt/Stanley", () => {
  assert.equal(brandConnectionKey("dewalt"), "dewalt")
  assert.equal(brandConnectionKey("stanley"), "stanley")
  assert.equal(brandConnectionKey("craftsman"), null)
})

test("resolveProvisioning rejects an unknown intent", () => {
  const res = resolveProvisioning("elevate", null, ctx())
  assert.deepEqual(res, { ok: false, reason: "invalid-intent" })
})

// --- 2. another-email (per-email) ------------------------------------------
test("another-email resolves to per-email for a verified alternate with no existing password", () => {
  const res = resolveProvisioning("another-email", "alt@example.com", ctx())
  assert.deepEqual(res, {
    ok: true,
    connectionKey: "per-email",
    email: "alt@example.com",
    useCase: "per-email-password",
  })
})

test("another-email normalizes the selected email", () => {
  const res = resolveProvisioning("another-email", "  ALT@Example.com ", ctx())
  assert.equal(res.ok && res.email, "alt@example.com")
})

test("another-email rejects an email the account has not verified", () => {
  const res = resolveProvisioning("another-email", "stranger@example.com", ctx())
  assert.deepEqual(res, { ok: false, reason: "email-not-eligible" })
})

test("another-email rejects a missing email", () => {
  const res = resolveProvisioning("another-email", null, ctx())
  assert.deepEqual(res, { ok: false, reason: "email-not-eligible" })
})

test("another-email rejects a DUPLICATE per-email credential", () => {
  const res = resolveProvisioning(
    "another-email",
    "alt@example.com",
    ctx({ existingBindings: [perEmailBinding("alt@example.com")] }),
  )
  assert.deepEqual(res, { ok: false, reason: "duplicate-credential" })
})

test("another-email rejects when the email already has a BRAND password (would collide on that brand)", () => {
  const res = resolveProvisioning(
    "another-email",
    "alt@example.com",
    ctx({ existingBindings: [brandBinding("alt@example.com", "dewalt")] }),
  )
  assert.deepEqual(res, { ok: false, reason: "conflicting-credential" })
})

test("another-email rejects when per-email connection is not configured", () => {
  const res = resolveProvisioning(
    "another-email",
    "alt@example.com",
    ctx({ configuredKeys: configuredConnectionKeys({ ...NAMES, "per-email": undefined }) }),
  )
  assert.deepEqual(res, { ok: false, reason: "not-configured" })
})

test("another-email: a scoped password on a DIFFERENT email does not block this one", () => {
  const res = resolveProvisioning(
    "another-email",
    "alt@example.com",
    ctx({ existingBindings: [perEmailBinding("primary@example.com")] }),
  )
  assert.equal(res.ok && res.connectionKey, "per-email")
})

// --- 3. this-brand (per-brand) ---------------------------------------------
test("this-brand resolves to the site brand connection for the verified primary email", () => {
  const res = resolveProvisioning("this-brand", null, ctx({ siteBrand: "dewalt" }))
  assert.deepEqual(res, {
    ok: true,
    connectionKey: "dewalt",
    email: "primary@example.com",
    useCase: "per-brand-password",
    brand: "dewalt",
  })
})

test("this-brand resolves to stanley on a Stanley storefront", () => {
  const res = resolveProvisioning("this-brand", null, ctx({ siteBrand: "stanley" }))
  assert.equal(res.ok && res.connectionKey, "stanley")
  assert.equal(res.ok && res.brand, "stanley")
})

test("this-brand rejects a brand with no connection (unsupported-brand)", () => {
  const res = resolveProvisioning("this-brand", null, ctx({ siteBrand: "craftsman" }))
  assert.deepEqual(res, { ok: false, reason: "unsupported-brand" })
})

test("this-brand rejects when the primary email is not verified", () => {
  const res = resolveProvisioning(
    "this-brand",
    null,
    ctx({ verifiedEmails: ["alt@example.com"] }),
  )
  assert.deepEqual(res, { ok: false, reason: "email-not-eligible" })
})

test("this-brand rejects a DUPLICATE brand credential", () => {
  const res = resolveProvisioning(
    "this-brand",
    null,
    ctx({ existingBindings: [brandBinding("primary@example.com", "dewalt")] }),
  )
  assert.deepEqual(res, { ok: false, reason: "duplicate-credential" })
})

test("this-brand rejects when the email already has a per-email password (would collide here)", () => {
  const res = resolveProvisioning(
    "this-brand",
    null,
    ctx({ existingBindings: [perEmailBinding("primary@example.com")] }),
  )
  assert.deepEqual(res, { ok: false, reason: "conflicting-credential" })
})

test("this-brand: an OTHER brand's password on the same email is allowed (does not collide here)", () => {
  const res = resolveProvisioning(
    "this-brand",
    null,
    ctx({ siteBrand: "dewalt", existingBindings: [brandBinding("primary@example.com", "stanley")] }),
  )
  assert.equal(res.ok && res.connectionKey, "dewalt")
})

test("this-brand rejects when the brand connection is not configured", () => {
  const res = resolveProvisioning(
    "this-brand",
    null,
    ctx({ configuredKeys: configuredConnectionKeys({ ...NAMES, dewalt: undefined }) }),
  )
  assert.deepEqual(res, { ok: false, reason: "not-configured" })
})

// --- 4. buildCredentialBinding + append ------------------------------------
test("buildCredentialBinding produces a coherent per-email binding", () => {
  const b = buildCredentialBinding({
    connectionKey: "per-email",
    email: "alt@example.com",
    useCase: "per-email-password",
    auth0UserId: "auth0|pe-9",
  })
  assert.deepEqual(b, {
    id: "per-email:auth0|pe-9",
    email: "alt@example.com",
    connectionKey: "per-email",
    auth0UserId: "auth0|pe-9",
    useCase: "per-email-password",
    brand: undefined,
  })
})

test("buildCredentialBinding produces a coherent brand binding", () => {
  const b = buildCredentialBinding({
    connectionKey: "stanley",
    email: "primary@example.com",
    useCase: "per-brand-password",
    auth0UserId: "auth0|st-9",
    brand: "stanley",
  })
  assert.equal(b.connectionKey, "stanley")
  assert.equal(b.brand, "stanley")
  assert.equal(b.id, "stanley:auth0|st-9")
})

test("buildCredentialBinding throws on an incoherent combination", () => {
  assert.throws(() =>
    buildCredentialBinding({
      connectionKey: "per-email",
      email: "x@example.com",
      useCase: "per-brand-password", // incoherent with per-email
      auth0UserId: "auth0|x",
    }),
  )
})

test("appendCredentialBinding preserves existing and adds the new one", () => {
  const existing = [perEmailBinding("a@example.com")]
  const added = brandBinding("b@example.com", "dewalt")
  const out = appendCredentialBinding(existing, added)
  assert.equal(out.length, 2)
  assert.notEqual(out, existing) // new array
  assert.equal(out[0].email, "a@example.com")
  assert.equal(out[1].email, "b@example.com")
})

test("appendCredentialBinding refuses a duplicate (same key + user id)", () => {
  const existing = [perEmailBinding("a@example.com")]
  const dup = perEmailBinding("a@example.com")
  const out = appendCredentialBinding(existing, dup)
  assert.equal(out.length, 1)
})

// --- 5. computeAddPasswordAvailability -------------------------------------
test("availability: fresh Model 1/2 account offers BOTH another-email and this-brand", () => {
  const a = computeAddPasswordAvailability(ctx())
  assert.equal(a.anotherEmail.available, true)
  assert.deepEqual(a.anotherEmail.eligibleEmails, ["primary@example.com", "alt@example.com"])
  assert.equal(a.thisBrand.available, true)
  assert.equal(a.thisBrand.brand, "dewalt")
  assert.equal(a.thisBrand.email, "primary@example.com")
})

test("availability: emails that already have a password drop out of the eligible list", () => {
  const a = computeAddPasswordAvailability(
    ctx({ existingBindings: [perEmailBinding("alt@example.com")] }),
  )
  assert.deepEqual(a.anotherEmail.eligibleEmails, ["primary@example.com"])
})

test("availability: this-brand unavailable with a neutral reason on an unsupported brand", () => {
  const a = computeAddPasswordAvailability(ctx({ siteBrand: "craftsman" }))
  assert.equal(a.thisBrand.available, false)
  assert.equal(a.thisBrand.reason, "unsupported-brand")
})

test("availability: another-email unavailable when per-email is not configured", () => {
  const a = computeAddPasswordAvailability(
    ctx({ configuredKeys: configuredConnectionKeys({ ...NAMES, "per-email": undefined }) }),
  )
  assert.equal(a.anotherEmail.available, false)
})
