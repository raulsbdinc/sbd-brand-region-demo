// UK Model 3 / Model 4 explicit journeys, CIAM-17 recovery gate and the UK
// 15-character password policy. Live evidence these pin:
//  - Auth0 sbd-demo-{dewalt,stanley,per-email}: password_options.complexity.min_length = 15
//    (an 8-char password was rejected only AFTER the OTP was consumed).
//  - Stanley-first auth0|6abc3a37909482f7dbb6116b (stanley brand cred + passwordless
//    secondary) → DeWalt "Create account, same email" POSTed per-email/verify/start
//    and got HTTP 409 {"error":"We couldn't complete that right now. Please try again."}.
//  - DeWalt-first auth0|6abc3ff794e0a7dc7ff41ad4 (per-email cred) → Stanley
//    "Create account, same email" got POST /api/registration/brand HTTP 409 (generic).
// Models 3 and 4 are alternative account journeys (hybrid four-password topology
// is pending a stakeholder decision): cross-model attempts must fail closed with
// an understandable message, never convert or create hybrid credentials.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  UK_PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordMinLength,
  passwordRequirementsText,
  validateRegistrationPassword,
  ukPasswordChecklist,
} from "./password-policy.ts"
import {
  drawerSignupFlow,
  defaultUkSignupModel,
  ukSignupModelCopy,
  interpretBrandSignupResponse,
  recoverySignupPreset,
} from "./drawer-signup.ts"
import { modelMismatchMessage } from "./account-model.ts"
import { detectOtherBrandOnlyCredential } from "./brand-duplicate.ts"
import {
  BRAND_NOT_SET_UP_CODE,
  brandNotSetUpMessage,
  canSubmitRecoveryReset,
} from "./recovery-drawer.ts"

// --- UK password policy: 15 characters + 3 of 4 --------------------------------

test("UK minimum is 15 characters; FR/DE follow the sbd-emea policy (15); default stays 8", () => {
  assert.equal(UK_PASSWORD_MIN_LENGTH, 15)
  assert.equal(passwordMinLength("uk"), 15)
  assert.equal(passwordMinLength("fr"), 15)
  assert.equal(passwordMinLength("de"), 15)
  assert.equal(passwordMinLength(), PASSWORD_MIN_LENGTH)
})

test("UK guidance text says 15 characters and 3 of 4 classes", () => {
  const uk = passwordRequirementsText("uk")
  assert.match(uk, /At least 15 characters/)
  assert.match(uk, /at least 3 of/)
  assert.doesNotMatch(uk, /At least 8/)
  assert.match(passwordRequirementsText("fr"), /At least 15 characters/)
})

test("UK pre-OTP validation rejects the exact 8-char repro shape", () => {
  const r = validateRegistrationPassword("Abcdef1!", ["someone@mailinator.com"], "uk")
  assert.equal(r.ok, false)
  assert.ok(r.failures.includes("At least 15 characters"))
  // FR/DE (CIAM-16): the real EU policy also rejects it.
  assert.equal(validateRegistrationPassword("Abcdef1!", ["someone@mailinator.com"], "fr").ok, false)
})

test("UK keeps the 3-of-4 app-side safeguard even at 15+ chars", () => {
  assert.equal(validateRegistrationPassword("abcdefghijklmnopq", [], "uk").ok, false)
  assert.equal(validateRegistrationPassword("abcdefghijklmnoP1", [], "uk").ok, true)
})

test("UK checklist shows 15-char, 3-of-4 and email rows", () => {
  const rows = ukPasswordChecklist("short", ["x@y.com"])
  assert.equal(rows[0].text, "At least 15 characters")
  assert.equal(rows[0].ok, false)
  assert.equal(rows.length, 3)
})

test("recovery reset submit is gated by the UK policy before the code is used", () => {
  const base = { code: "123456", market: "uk", email: "a@b.com" }
  assert.equal(canSubmitRecoveryReset({ ...base, next: "Abcdef1!", confirm: "Abcdef1!" }), false)
  const good = "Stronger-Pass-2026"
  assert.equal(canSubmitRecoveryReset({ ...base, next: good, confirm: good }), true)
  assert.equal(canSubmitRecoveryReset({ ...base, market: "fr", next: "Abcdef1!", confirm: "Abcdef1!" }), false)
  const euMin = "a".repeat(15)
  assert.equal(canSubmitRecoveryReset({ ...base, market: "fr", next: euMin, confirm: euMin }), true)
})

// --- Explicit Model 3 / Model 4 choice on BOTH UK sites ----------------------

test("either model can be chosen explicitly on DeWalt UK and Stanley UK", () => {
  for (const brand of ["dewalt", "stanley"] as const) {
    assert.equal(drawerSignupFlow("uk", brand, "per-email", true), "per-email")
    assert.equal(drawerSignupFlow("uk", brand, "per-brand", true), "per-brand")
  }
})

test("defaults preserve existing host behaviour when no choice is made", () => {
  assert.equal(defaultUkSignupModel("dewalt", true), "per-email")
  assert.equal(defaultUkSignupModel("stanley", true), "per-brand")
  assert.equal(drawerSignupFlow("uk", "stanley"), "per-brand")
})

test("model copy is plain language and names both storefronts", () => {
  const m3 = ukSignupModelCopy("per-email", "stanley")
  assert.match(m3.description, /STANLEY/i)
  assert.match(m3.description, /DEWALT/i)
  const m4 = ukSignupModelCopy("per-brand", "dewalt")
  assert.match(m4.title, /DEWALT/i)
  assert.doesNotMatch(m3.title + m4.title, /connection|sbd-demo/i)
})

// --- Cross-model 409s become understandable refusals -------------------------

test("brand route model-mismatch 409 is surfaced, not a generic failure", () => {
  const message = modelMismatchMessage("per-email")
  const a = interpretBrandSignupResponse({
    httpStatus: 409,
    body: { reason: "model-mismatch", error: message },
  })
  assert.equal(a.kind, "model-mismatch")
  assert.ok("message" in a && a.message === message)
  assert.doesNotMatch(message, /couldn't complete that right now/)
})

test("mismatch copy explains the existing model and a safe way forward", () => {
  assert.match(modelMismatchMessage("per-email", true), /one password per email/)
  assert.match(modelMismatchMessage("per-email", true), /sign in/i)
  assert.match(modelMismatchMessage("per-brand"), /separate password for each brand/)
  assert.doesNotMatch(modelMismatchMessage("other"), /sbd-demo|connection/)
})

// --- CIAM-17: Stanley-only account on DeWalt forgot-password ------------------

const STANLEY_ONLY = {
  ownedEmails: ["sbdciam-stanley-only-2909@mailinator.com", "sbdciam-stanley-second-2909@mailinator.com"],
  identities: [{ connectionKey: "stanley" as const, userId: "auth0|6abc3a37909482f7dbb6116b" }],
}

test("CIAM-17: Stanley-only email on DeWalt recovery is 'brand not set up'", () => {
  for (const email of STANLEY_ONLY.ownedEmails) {
    assert.equal(
      detectOtherBrandOnlyCredential({ email, brandKey: "dewalt", candidates: [STANLEY_ONLY as never] }),
      true,
    )
  }
})

test("CIAM-17: gate does not fire when this brand, per-email or shared can be reset", () => {
  for (const key of ["dewalt", "per-email", "shared"] as const) {
    const owner = { ...STANLEY_ONLY, identities: [...STANLEY_ONLY.identities, { connectionKey: key, userId: "x" }] }
    assert.equal(
      detectOtherBrandOnlyCredential({
        email: STANLEY_ONLY.ownedEmails[0],
        brandKey: "dewalt",
        candidates: [owner as never],
      }),
      false,
    )
  }
})

test("CIAM-17: unknown email falls through to neutral recovery", () => {
  assert.equal(
    detectOtherBrandOnlyCredential({ email: "nobody@x.com", brandKey: "dewalt", candidates: [STANLEY_ONLY as never] }),
    false,
  )
})

test("CIAM-17: guidance names the storefront and points to Create account", () => {
  assert.equal(BRAND_NOT_SET_UP_CODE, "brand-not-set-up")
  const msg = brandNotSetUpMessage("DEWALT")
  assert.match(msg, /DEWALT/)
  assert.match(msg, /create/i)
})

// --- CIAM-17 recovery → Create Account pre-selects Model 4 ---------------------
// Live-main finding (PR #67): verified Stanley-only Model 4 root
// auth0|6abc3a37909482f7dbb6116b hit DeWalt forgot-password → gate → "Create an
// account with this email", but DeWalt's drawer kept its default Model 3
// ("A password for each email") selected — a guaranteed model mismatch.

test("the recovery gate only fires for a brand-only (Model 4) account", () => {
  const stanleyOnly = [{ ownedEmails: ["a@x.test"], identities: [{ connectionKey: "stanley" }] }]
  const perEmail = [{ ownedEmails: ["a@x.test"], identities: [{ connectionKey: "per-email" }] }]
  const both = [{ ownedEmails: ["a@x.test"], identities: [{ connectionKey: "stanley" }, { connectionKey: "dewalt" }] }]
  const gate = (candidates: any) => detectOtherBrandOnlyCredential({ email: "a@x.test", brandKey: "dewalt", candidates })
  assert.equal(gate(stanleyOnly), true)
  assert.equal(gate(perEmail), false, "Model 3 password already works on DeWalt")
  assert.equal(gate(both), false)
})

test("recovery handoff pre-selects the separate brand password on BOTH UK sites", () => {
  for (const brand of ["dewalt", "stanley"] as const) {
    const preset = recoverySignupPreset(brand, true)
    assert.equal(preset.model, "per-brand")
    assert.equal(drawerSignupFlow("uk", brand, preset.model), "per-brand")
    const title = ukSignupModelCopy("per-brand", brand).title
    assert.ok(preset.note.includes(title), "note names the option it selected")
    assert.match(preset.note, /code/i)
    assert.match(preset.note, /existing password stays unchanged/)
  }
})

test("DeWalt recovery preset overrides DeWalt's Model 3 default; note never names the sister brand", () => {
  assert.equal(defaultUkSignupModel("dewalt", true), "per-email")
  const preset = recoverySignupPreset("dewalt", true)
  assert.notEqual(preset.model, defaultUkSignupModel("dewalt", true))
  assert.match(preset.note, /DEWALT/i)
  assert.doesNotMatch(preset.note, /stanley/i)
  assert.doesNotMatch(recoverySignupPreset("stanley", true).note, /dewalt/i)
})

test("normal new-account entry keeps the site defaults (explicit choice preserved)", () => {
  assert.equal(drawerSignupFlow("uk", "dewalt", undefined, true), "per-email")
  assert.equal(drawerSignupFlow("uk", "stanley", undefined, true), "per-brand")
  assert.equal(drawerSignupFlow("fr", "dewalt", recoverySignupPreset("dewalt").model), "per-brand", "EU is brand-password only")
})
