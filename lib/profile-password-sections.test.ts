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
