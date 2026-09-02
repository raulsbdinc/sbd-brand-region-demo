// Unit tests for the PURE current-brand duplicate detector (no framework, no
// network). Run with:  node --test lib/brand-duplicate.test.ts
//
// These lock in the UX contract for the storefront Create Account drawer:
//   • current brand already exists for the email → detected (drawer shows
//     "try signing in instead", never a duplicate, never a generic failure),
//   • other-brand-ONLY → NOT detected, so the flow falls through to the
//     cross-brand OTP activation path (unchanged),
//   • symmetric across DeWalt and Stanley,
//   • deterministic even when a second (stale/linked) candidate is present,
//   • conservative: never matches a brand identity that belongs to a DIFFERENT
//     email (no cross-account leakage).

import { test } from "node:test"
import assert from "node:assert/strict"

import { detectCurrentBrandCredential } from "./brand-duplicate.ts"
import type { LinkedDbIdentity } from "./credential-model.ts"

const EMAIL = "xayogew192@mapsguy.com"

function idn(...keys: LinkedDbIdentity["connectionKey"][]): LinkedDbIdentity[] {
  return keys.map((connectionKey, i) => ({ connectionKey, userId: `id-${i}` }))
}

test("current brand exists (dewalt) for an owned email → detected", () => {
  assert.equal(
    detectCurrentBrandCredential({
      email: EMAIL,
      brandKey: "dewalt",
      candidates: [{ ownedEmails: [EMAIL], identities: idn("dewalt") }],
    }),
    true,
  )
})

test("symmetric: current brand exists (stanley) for an owned email → detected", () => {
  assert.equal(
    detectCurrentBrandCredential({
      email: EMAIL,
      brandKey: "stanley",
      candidates: [{ ownedEmails: [EMAIL], identities: idn("stanley") }],
    }),
    true,
  )
})

test("both brands linked on one account → detected for EITHER brand", () => {
  const candidates = [{ ownedEmails: [EMAIL], identities: idn("dewalt", "stanley") }]
  assert.equal(detectCurrentBrandCredential({ email: EMAIL, brandKey: "dewalt", candidates }), true)
  assert.equal(detectCurrentBrandCredential({ email: EMAIL, brandKey: "stanley", candidates }), true)
})

test("other-brand ONLY (stanley) while creating dewalt → NOT detected (falls through to OTP link)", () => {
  assert.equal(
    detectCurrentBrandCredential({
      email: EMAIL,
      brandKey: "dewalt",
      candidates: [{ ownedEmails: [EMAIL], identities: idn("stanley") }],
    }),
    false,
  )
})

test("deterministic despite a second (stale/linked) candidate for the same email", () => {
  // Right after a cross-brand link the just-created-then-linked secondary can
  // transiently show up as its own candidate; the primary still carries the
  // current-brand identity, so detection must not be defeated by the extra row.
  assert.equal(
    detectCurrentBrandCredential({
      email: EMAIL,
      brandKey: "dewalt",
      candidates: [
        { ownedEmails: [EMAIL], identities: idn("dewalt", "stanley") },
        { ownedEmails: [EMAIL], identities: idn("stanley") },
      ],
    }),
    true,
  )
})

test("brand identity belongs to a DIFFERENT email → NOT detected (no cross-account leak)", () => {
  assert.equal(
    detectCurrentBrandCredential({
      email: EMAIL,
      brandKey: "dewalt",
      candidates: [{ ownedEmails: ["someone-else@example.com"], identities: idn("dewalt") }],
    }),
    false,
  )
})

test("owns the email but has NO current-brand identity → NOT detected", () => {
  assert.equal(
    detectCurrentBrandCredential({
      email: EMAIL,
      brandKey: "dewalt",
      candidates: [{ ownedEmails: [EMAIL], identities: idn("shared", "per-email") }],
    }),
    false,
  )
})

test("no candidates / blank email → NOT detected", () => {
  assert.equal(detectCurrentBrandCredential({ email: EMAIL, brandKey: "dewalt", candidates: [] }), false)
  assert.equal(
    detectCurrentBrandCredential({
      email: "",
      brandKey: "dewalt",
      candidates: [{ ownedEmails: [EMAIL], identities: idn("dewalt") }],
    }),
    false,
  )
})

test("owned-email matching is case/space insensitive", () => {
  assert.equal(
    detectCurrentBrandCredential({
      email: "  XAYOGEW192@MapsGuy.com ",
      brandKey: "dewalt",
      candidates: [{ ownedEmails: [EMAIL], identities: idn("dewalt") }],
    }),
    true,
  )
})
