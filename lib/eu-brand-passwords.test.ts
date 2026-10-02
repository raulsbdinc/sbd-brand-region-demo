// 1 October (Mark Luvaas): on the EU tenant sbd-emea-temp1, DeWalt France and
// DeWalt Germany share ONE DeWalt password; Stanley France has its own.
// Per-email passwords never appear outside UK.

import { test } from "node:test"
import assert from "node:assert/strict"

import { brandAccessEnforced, identitiesAuthorizeBrand } from "./brand-access.ts"
import {
  EU_PASSWORD_MIN_LENGTH,
  passwordMinLength,
  passwordRequirementsText,
  validateRegistrationPassword,
} from "./password-policy.ts"
import { connectionKeyForName, resolveConnectionNames } from "./credential-model.ts"
import { drawerSignupFlow } from "./drawer-signup.ts"
import { perEmailAccountsEnabled } from "./uk-feature-flags.ts"

const EU_ENV = {
  NEXT_PUBLIC_AUTH0_CONNECTION: "sbd-emea",
  AUTH0_DEWALT_CONNECTION: "sbd-emea-dewalt",
  AUTH0_STANLEY_CONNECTION: "sbd-emea-stanley",
}
const names = resolveConnectionNames(EU_ENV)

const dewalt = { brand: names.dewalt, shared: names.shared }
const stanley = { brand: names.stanley, shared: names.shared }

// --- CIAM-16: guidance, client validation and Auth0 policy agree ------------

test("FR/DE minimum length is 8, and the guidance says so", () => {
  assert.equal(EU_PASSWORD_MIN_LENGTH, 8)
  for (const m of ["fr", "de"]) {
    assert.equal(passwordMinLength(m), 8)
    assert.match(passwordRequirementsText(m), /At least 8 characters/)
    assert.doesNotMatch(passwordRequirementsText(m), /15/)
  }
})

test("FR/DE true boundary: 7 characters rejected, valid 8 without a digit accepted (before any code is sent)", () => {
  for (const m of ["fr", "de"]) {
    const r7 = validateRegistrationPassword("Jane!ab", ["jane@example.com"], m)
    assert.equal(r7.ok, false, `${m}: 7 chars must fail`)
    assert.deepEqual(r7.failures, ["At least 8 characters"])
    const r8 = validateRegistrationPassword("Jane!abc", ["jane@example.com"], m)
    assert.equal(r8.ok, true, `${m}: valid 8 chars with a name substring must pass`)
  }
})

test("FR/DE use the same class rule as UK and the 72-byte cap", () => {
  assert.equal(validateRegistrationPassword("Abcdef1!", [], "fr").ok, true)
  assert.equal(validateRegistrationPassword("abcdefgh", [], "fr").ok, false)
  assert.equal(validateRegistrationPassword("Aa!" + "a".repeat(70), [], "de").ok, false)
})

// --- DeWalt shared across FR and DE ----------------------------------------

test("DeWalt FR and DeWalt DE resolve to the SAME brand connection (one credential, one reset)", () => {
  assert.equal(names.dewalt, "sbd-emea-dewalt")
  assert.equal(connectionKeyForName("sbd-emea-dewalt", names), "dewalt")
  // Both markets read the same env contract, so FR-first and DE-first land on one identity.
  const fr = resolveConnectionNames({ ...EU_ENV, NEXT_PUBLIC_MARKET: "fr" })
  const de = resolveConnectionNames({ ...EU_ENV, NEXT_PUBLIC_MARKET: "de" })
  assert.equal(fr.dewalt, de.dewalt)
})

test("FR-first and DE-first DeWalt enrollment both authorize the other DeWalt market", () => {
  const enrolledViaEitherMarket = [{ connection: "sbd-emea-dewalt" }]
  assert.equal(identitiesAuthorizeBrand(enrolledViaEitherMarket, dewalt), true)
})

test("signup on all three EU storefronts is brand-password only", () => {
  for (const m of ["fr", "de"] as const) {
    assert.equal(drawerSignupFlow(m, "dewalt"), "per-brand")
  }
  assert.equal(drawerSignupFlow("fr", "stanley"), "per-brand")
})

// --- Stanley isolation ------------------------------------------------------

test("a DeWalt-only account is NOT authorized on Stanley (no bypass via Google/passcode)", () => {
  assert.equal(brandAccessEnforced("fr"), true)
  assert.equal(identitiesAuthorizeBrand([{ connection: "sbd-emea-dewalt" }], stanley), false)
  assert.equal(identitiesAuthorizeBrand([{ connection: "google-oauth2" }], stanley), false)
})

test("a Stanley-only account is NOT authorized on DeWalt", () => {
  assert.equal(identitiesAuthorizeBrand([{ connection: "sbd-emea-stanley" }], dewalt), false)
})

test("after explicit Stanley enrollment + ownership link, the canonical user holds both brands", () => {
  const linked = [{ connection: "sbd-emea-dewalt" }, { connection: "sbd-emea-stanley" }]
  assert.equal(identitiesAuthorizeBrand(linked, dewalt), true)
  assert.equal(identitiesAuthorizeBrand(linked, stanley), true)
  // The two identities stay on different connections, so the reset lifecycles are independent.
  assert.notEqual(connectionKeyForName("sbd-emea-stanley", names), connectionKeyForName("sbd-emea-dewalt", names))
})

test("a brand gate with no brand connection configured fails closed", () => {
  assert.equal(identitiesAuthorizeBrand([{ connection: "sbd-emea" }], { shared: "sbd-emea" }), false)
})

// --- Legacy shared users ----------------------------------------------------

test("Model 4 only: a legacy shared sbd-emea identity grants NO brand access (no grandfathering)", () => {
  assert.equal(identitiesAuthorizeBrand([{ connection: "sbd-emea" }], dewalt), false)
  assert.equal(identitiesAuthorizeBrand([{ connection: "sbd-emea" }], stanley), false)
  assert.equal(
    identitiesAuthorizeBrand([{ connection: "sbd-emea" }, { connection: "google-oauth2" }], dewalt),
    false,
  )
})

// --- Per-email stays UK-only and off ---------------------------------------

test("per-email is never enabled outside UK, even if the flag is forced on", () => {
  for (const m of ["fr", "de"]) {
    assert.equal(perEmailAccountsEnabled(m as never, true), false)
    assert.equal(drawerSignupFlow(m as "fr", "dewalt", "per-email", true), "per-brand")
  }
})

// --- UK regression ---------------------------------------------------------

test("UK: 8-char policy, per-brand by default, and the Model 4 brand gate IS enforced", () => {
  assert.equal(passwordMinLength("uk"), 8)
  assert.equal(drawerSignupFlow("uk", "dewalt", undefined, false), "per-brand")
  assert.equal(drawerSignupFlow("uk", "stanley", undefined, false), "per-brand")
  assert.equal(brandAccessEnforced("uk"), true)
})
