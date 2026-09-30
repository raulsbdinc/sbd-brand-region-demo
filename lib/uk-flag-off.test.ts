// CIAM standup 2026-09-30: the UK demo offers ONLY a separate password for each
// brand. The "password for each email" setup is behind
// NEXT_PUBLIC_UK_PER_EMAIL_ACCOUNTS, OFF by default. These tests pin the
// flag-off contract; the historical flag-on cases pin `perEmailEnabled: true`.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  LEGACY_PER_EMAIL_ACCOUNT_MESSAGE,
  LEGACY_PER_EMAIL_PROFILE_LINE,
  PER_EMAIL_UNAVAILABLE_MESSAGE,
  UK_PER_EMAIL_ACCOUNTS_FLAG,
  parseFlag,
  perEmailAccountsEnabled,
} from "./uk-feature-flags.ts"
import {
  defaultUkSignupModel,
  drawerSignupFlow,
  recoverySignupPreset,
  ukBrandPasswordIntro,
  ukSignupModels,
} from "./drawer-signup.ts"
import { modelMismatchMessage } from "./account-model.ts"
import {
  profilePasswordModelVisibility,
  resolveProfilePasswordSections,
} from "./brand-password-actions.ts"

const UK_BRANDS = ["dewalt", "stanley"] as const

// --- The flag itself ---------------------------------------------------------

test("flag is OFF by default in this environment", () => {
  assert.equal(UK_PER_EMAIL_ACCOUNTS_FLAG, false)
  assert.equal(perEmailAccountsEnabled("uk"), false)
})

test("only an explicit 'on' value enables the flag", () => {
  for (const raw of [undefined, null, "", "0", "false", "off", "no", "enabled?", " "]) {
    assert.equal(parseFlag(raw as string | undefined), false, `raw=${String(raw)}`)
  }
  for (const raw of ["1", "true", "TRUE", " on ", "yes"]) {
    assert.equal(parseFlag(raw), true, `raw=${raw}`)
  }
})

test("flag is scoped to the UK market: EU is never per-email, even if forced on", () => {
  for (const market of ["fr", "de", "us"] as const) {
    assert.equal(perEmailAccountsEnabled(market, true), false)
    assert.equal(perEmailAccountsEnabled(market, false), false)
  }
  assert.equal(perEmailAccountsEnabled("uk", true), true)
})

// --- Create Account: per-brand password only --------------------------------

test("flag off: both UK storefronts default to a separate brand password", () => {
  for (const brand of UK_BRANDS) {
    assert.equal(defaultUkSignupModel(brand, false), "per-brand")
    assert.equal(drawerSignupFlow("uk", brand, undefined, false), "per-brand")
    assert.deepEqual(ukSignupModels(false), ["per-brand"])
  }
})

test("flag off: a stale or forged per-email choice falls back to the BRAND password, never shared", () => {
  for (const brand of UK_BRANDS) {
    const flow = drawerSignupFlow("uk", brand, "per-email", false)
    assert.equal(flow, "per-brand")
    assert.notEqual(flow, "shared")
  }
})

test("flag off: EU signup is untouched (still the shared account)", () => {
  for (const market of ["fr", "de"] as const) {
    for (const brand of UK_BRANDS) {
      assert.equal(drawerSignupFlow(market, brand, undefined, false), "shared")
      assert.equal(drawerSignupFlow(market, brand, undefined, true), "shared")
    }
  }
})

test("flag off: Create Account copy explains same email, different password per brand, OTP", () => {
  const onDeWalt = ukBrandPasswordIntro("dewalt")
  assert.match(onDeWalt.title, /DEWALT/i)
  assert.match(onDeWalt.description, /same verified email/i)
  assert.match(onDeWalt.description, /STANLEY/i)
  assert.match(onDeWalt.description, /own different password/i)
  assert.match(onDeWalt.description, /code/i)
  assert.match(onDeWalt.description, /sign in with your email and the password for the site/i)
  const onStanley = ukBrandPasswordIntro("stanley")
  assert.match(onStanley.title, /STANLEY/i)
  assert.match(onStanley.description, /DEWALT/i)
  for (const copy of [onDeWalt, onStanley]) {
    const text = copy.title + copy.description
    assert.doesNotMatch(text, /model\s*\d|sbd-demo|connection|per-email|one password for both/i)
  }
})

// --- Recovery -> Create Account ---------------------------------------------

test("flag off: recovery handoff selects the brand password with plain copy", () => {
  for (const brand of UK_BRANDS) {
    const preset = recoverySignupPreset(brand, false)
    assert.equal(preset.model, "per-brand")
    assert.match(preset.note, /different/i)
    assert.match(preset.note, /code/i)
    assert.match(preset.note, /existing password stays unchanged/)
    assert.doesNotMatch(preset.note, /model\s*\d|per email|each email|sbd-demo/i)
  }
  assert.doesNotMatch(recoverySignupPreset("dewalt", false).note, /stanley/i)
  assert.doesNotMatch(recoverySignupPreset("stanley", false).note, /dewalt/i)
})

// --- Existing per-email accounts: safe, never converted ---------------------

test("flag off: an existing per-email account gets neutral guidance, no per-email choice", () => {
  const msg = modelMismatchMessage("per-email", false)
  assert.equal(msg, LEGACY_PER_EMAIL_ACCOUNT_MESSAGE)
  assert.match(msg, /sign in with your existing password/i)
  assert.match(msg, /forgot password/i)
  assert.match(msg, /nothing has been changed/i)
  assert.doesNotMatch(msg, /per email|each email|model\s*\d|sbd-demo|connection/i)
  // Brand accounts still get the same explanation as before.
  assert.equal(modelMismatchMessage("per-brand", false), modelMismatchMessage("per-brand", true))
})

test("flag off: per-email endpoint refusal is neutral and points to the brand password", () => {
  assert.match(PER_EMAIL_UNAVAILABLE_MESSAGE, /isn't available here/)
  assert.match(PER_EMAIL_UNAVAILABLE_MESSAGE, /password for this brand/)
  assert.doesNotMatch(PER_EMAIL_UNAVAILABLE_MESSAGE, /per email|each email|model\s*\d/i)
})

// --- Profile / account controls ---------------------------------------------

test("flag off: neither UK storefront exposes per-email account controls", () => {
  for (const brand of UK_BRANDS) {
    const v = profilePasswordModelVisibility({ market: "uk", brand, perEmailEnabled: false })
    assert.equal(v.perEmail, false, `${brand} must hide per-email controls`)
    assert.equal(v.perBrand, true, `${brand} keeps brand password controls`)
  }
})

test("flag off: a legacy per-email account sees a neutral notice, no per-email actions, no conversion", () => {
  for (const host of [
    { hostPerEmailModel: true, hostPerBrandModel: false },
    { hostPerEmailModel: false, hostPerBrandModel: true },
  ]) {
    const s = resolveProfilePasswordSections({
      ...host,
      perEmailEnabled: false,
      facts: { hasPerEmailCredentials: true, hasBrandCredentials: true },
    })
    assert.equal(s.showPerEmailActions, false)
    assert.equal(s.legacyPerEmailAccount, true)
    // The legacy account is never shown the brand-password section either:
    // presenting it would imply the account had been converted to that setup.
    assert.equal(s.showBrandSection, false)
  }
  assert.match(LEGACY_PER_EMAIL_PROFILE_LINE, /existing passwords still work/)
  assert.doesNotMatch(LEGACY_PER_EMAIL_PROFILE_LINE, /model\s*\d|per email|each email/i)
})

test("flag off: brand-password accounts keep their brand section on BOTH UK storefronts", () => {
  for (const host of [
    { hostPerEmailModel: true, hostPerBrandModel: false },
    { hostPerEmailModel: false, hostPerBrandModel: true },
  ]) {
    const s = resolveProfilePasswordSections({
      ...host,
      perEmailEnabled: false,
      facts: { hasPerEmailCredentials: false, hasBrandCredentials: true },
    })
    assert.equal(s.showBrandSection, true)
    assert.equal(s.showPerEmailActions, false)
    assert.equal(s.legacyPerEmailAccount, false)
  }
})

test("flag off: a fresh UK account defaults to the brand password section, not per-email", () => {
  const s = resolveProfilePasswordSections({
    hostPerEmailModel: true,
    hostPerBrandModel: false,
    perEmailEnabled: false,
    facts: { hasPerEmailCredentials: false, hasBrandCredentials: false },
  })
  assert.equal(s.showPerEmailActions, false)
  assert.equal(s.legacyPerEmailAccount, false)
})
