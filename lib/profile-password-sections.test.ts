// GLSCM-4834 follow-up — account-aware profile password-section resolution.
// The bug: presentation was inferred from the storefront host, so a Model 4
// account opened on DeWalt UK saw no Brand passwords section (and the wrong
// "one password" welcome copy). These tests pin the account-aware rules.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  accountCredentialFactsFromMethods,
  resolveProfilePasswordSections,
} from "./brand-password-actions.ts"

// Host-gate shorthands for the two UK storefronts and EU.
const DEWALT_UK = { hostPerEmailModel: true, hostPerBrandModel: false }
const STANLEY_UK = { hostPerEmailModel: false, hostPerBrandModel: true }
const EU = { hostPerEmailModel: false, hostPerBrandModel: false }

const NO_CREDS = { hasPerEmailCredentials: false, hasBrandCredentials: false }
const BRAND_CREDS = { hasPerEmailCredentials: false, hasBrandCredentials: true }
const PER_EMAIL_CREDS = { hasPerEmailCredentials: true, hasBrandCredentials: false }
// A canonical Model 3 account: its per-email credential co-exists with the
// brand DB credential it was provisioned against, so BOTH facts are true.
const PER_EMAIL_AND_BRAND_CREDS = {
  hasPerEmailCredentials: true,
  hasBrandCredentials: true,
}

// --- accountCredentialFactsFromMethods --------------------------------------

test("facts: brand connection keys mark a Model 4 account", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "dewalt" },
    { kind: "password", connectionKey: "stanley" },
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: false,
    hasBrandCredentials: true,
  })
})

test("facts: a single brand credential still marks brand creds", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "stanley" },
  ])
  assert.equal(facts.hasBrandCredentials, true)
  assert.equal(facts.hasPerEmailCredentials, false)
})

test("facts: per-email connection key marks a Model 3 account", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "per-email" },
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: true,
    hasBrandCredentials: false,
  })
})

test("facts: shared password and non-password rows are neither model", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "shared" },
    { kind: "passkey", connectionKey: "dewalt" }, // non-password ignored
    { kind: "social" },
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: false,
    hasBrandCredentials: false,
  })
})

// --- Model 4 account: brand section on BOTH UK storefronts ------------------

test("Model 4 account on DeWalt UK shows the Brand section, not per-email", () => {
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts: BRAND_CREDS })
  assert.equal(s.showBrandSection, true) // the core bug fix
  assert.equal(s.showPerEmailActions, false)
})

test("Model 4 account on Stanley UK shows the Brand section", () => {
  const s = resolveProfilePasswordSections({ ...STANLEY_UK, facts: BRAND_CREDS })
  assert.equal(s.showBrandSection, true)
  assert.equal(s.showPerEmailActions, false)
})

// --- Overlap: canonical Model 3 that ALSO holds a brand DB credential -------
// Real regression (giledos375@bowlfuel.com on DeWalt UK): a per-email account
// naturally carries a DeWalt DB credential too, so facts were {true,true} and
// the resolver wrongly rendered BOTH per-email actions AND a Brand section with
// "Change DeWalt password". Per-email must win the overlap.

test("overlap {perEmail:true, brand:true} on DeWalt UK is Model 3 only", () => {
  const s = resolveProfilePasswordSections({
    ...DEWALT_UK,
    facts: PER_EMAIL_AND_BRAND_CREDS,
  })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false) // the fix: no Brand section
})

test("overlap {perEmail:true, brand:true} on Stanley UK exposes neither", () => {
  // Per-email never leaks onto Stanley UK; and per-email winning means the
  // brand section stays hidden for this Model 3 account there too.
  const s = resolveProfilePasswordSections({
    ...STANLEY_UK,
    facts: PER_EMAIL_AND_BRAND_CREDS,
  })
  assert.equal(s.showPerEmailActions, false)
  assert.equal(s.showBrandSection, false)
})

test("giledos login-method shape resolves to Model 3 on DeWalt UK", () => {
  // Mirrors the real account: primary + secondary per-email credentials plus
  // the DeWalt DB credential they were provisioned against.
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "per-email" }, // giledos375@bowlfuel.com
    { kind: "password", connectionKey: "per-email" }, // fatrazigna@necub.com
    { kind: "password", connectionKey: "dewalt" }, // canonical brand DB credential
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: true,
    hasBrandCredentials: true,
  })
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false)
})

// --- Model 3 account: per-email preserved on DeWalt UK ----------------------

test("Model 3 account on DeWalt UK keeps per-email actions, no brand section", () => {
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts: PER_EMAIL_CREDS })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false)
})

test("Model 3 account on Stanley UK exposes neither model's controls", () => {
  // Per-email must never leak onto Stanley UK, and a per-email account must not
  // be offered a brand set (that would mix models at the backend).
  const s = resolveProfilePasswordSections({ ...STANLEY_UK, facts: PER_EMAIL_CREDS })
  assert.equal(s.showPerEmailActions, false)
  assert.equal(s.showBrandSection, false)
})

// --- Fresh accounts keep the host default -----------------------------------

test("fresh account on DeWalt UK defaults to per-email actions", () => {
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts: NO_CREDS })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false)
})

test("fresh account on Stanley UK defaults to the Brand section", () => {
  const s = resolveProfilePasswordSections({ ...STANLEY_UK, facts: NO_CREDS })
  assert.equal(s.showBrandSection, true)
  assert.equal(s.showPerEmailActions, false)
})

// --- EU Models 1/2 never change ---------------------------------------------

test("EU shows neither section regardless of account facts", () => {
  for (const facts of [NO_CREDS, BRAND_CREDS, PER_EMAIL_CREDS]) {
    const s = resolveProfilePasswordSections({ ...EU, facts })
    assert.equal(s.showPerEmailActions, false)
    assert.equal(s.showBrandSection, false)
  }
})
