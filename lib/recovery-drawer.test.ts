import { test } from "node:test"
import assert from "node:assert/strict"

import {
  interpretRecoveryStartResponse,
  interpretRecoveryResetResponse,
  recoverySuccessMessage,
  canSubmitRecoveryReset,
  selectorForRecovery,
} from "./recovery-drawer.ts"

// --- start step --------------------------------------------------------------

test("recovery start: any 2xx advances to the code step (non-enumerating)", () => {
  assert.deepEqual(
    interpretRecoveryStartResponse({ httpStatus: 200, body: {} }),
    { kind: "sent" },
  )
  assert.deepEqual(
    interpretRecoveryStartResponse({ httpStatus: 202, body: { ok: true } }),
    { kind: "sent" },
  )
})

test("recovery start: a transport/server failure keeps the customer on email", () => {
  const action = interpretRecoveryStartResponse({
    httpStatus: 500,
    body: { error: "Service unavailable" },
  })
  assert.equal(action.kind, "error")
  assert.equal(
    action.kind === "error" ? action.message : null,
    "Service unavailable",
  )
})

// --- reset step --------------------------------------------------------------

test("recovery reset: 2xx surfaces the exact reset email + customer-facing scope", () => {
  const action = interpretRecoveryResetResponse({
    httpStatus: 200,
    body: { credential: { email: "b@necub.com", scope: "per-email" } },
  })
  assert.equal(action.kind, "reset")
  assert.equal(action.kind === "reset" ? action.email : null, "b@necub.com")
  assert.equal(action.kind === "reset" ? action.scope : null, "per-email")
})

test("recovery reset: 2xx carries the brand name for a brand-scoped reset", () => {
  const action = interpretRecoveryResetResponse({
    httpStatus: 200,
    body: { credential: { email: "x@necub.com", scope: "brand", brandName: "DeWalt" } },
  })
  assert.equal(action.kind, "reset")
  assert.equal(action.kind === "reset" ? action.scope : null, "brand")
  assert.equal(action.kind === "reset" ? action.brandName : null, "DeWalt")
})

test("recovery reset: an unknown scope is dropped (defends the success copy)", () => {
  const action = interpretRecoveryResetResponse({
    httpStatus: 200,
    body: { credential: { email: "b@necub.com", scope: "per-email-binding" } },
  })
  assert.equal(action.kind === "reset" ? action.scope : "MISSING", undefined)
})

// --- success copy (customer-facing, no internal jargon) ----------------------

test("recoverySuccessMessage: Model 3 names the exact proven email", () => {
  assert.equal(
    recoverySuccessMessage({ scope: "per-email", email: "lodresarde@necub.com" }),
    "The password for lodresarde@necub.com has been updated.",
  )
})

test("recoverySuccessMessage: Model 4 names the brand naturally", () => {
  assert.equal(
    recoverySuccessMessage({ scope: "brand", brandName: "DeWalt" }),
    "Your DeWalt password has been updated.",
  )
})

test("recoverySuccessMessage: shared / unresolved stays generic — never jargon", () => {
  assert.equal(
    recoverySuccessMessage({ scope: "shared", email: "a@necub.com" }),
    "Your password has been updated.",
  )
  // Missing pieces must never fall back to a label like "Per-email password".
  assert.equal(
    recoverySuccessMessage({ scope: "per-email" }),
    "Your password has been updated.",
  )
  assert.equal(
    recoverySuccessMessage({ scope: "brand" }),
    "Your password has been updated.",
  )
  assert.equal(recoverySuccessMessage({}), "Your password has been updated.")
})

test("recoverySuccessMessage: never emits internal jargon for any scope", () => {
  for (const message of [
    recoverySuccessMessage({ scope: "per-email", email: "b@necub.com" }),
    recoverySuccessMessage({ scope: "brand", brandName: "Stanley" }),
    recoverySuccessMessage({ scope: "shared" }),
    recoverySuccessMessage({}),
  ]) {
    assert.doesNotMatch(message, /per-email|binding|connection|model\s*\d/i)
  }
})

test("recovery reset: a wrong/expired code stays on the step (bad-code)", () => {
  assert.deepEqual(
    interpretRecoveryResetResponse({
      httpStatus: 400,
      body: { code: "bad-code" },
    }),
    { kind: "bad-code" },
  )
})

test("recovery reset: a policy failure maps to weak-password", () => {
  assert.deepEqual(
    interpretRecoveryResetResponse({
      httpStatus: 400,
      body: { code: "weak-password" },
    }),
    { kind: "weak-password" },
  )
})

test("recovery reset: anything else is a neutral generic failure", () => {
  const action = interpretRecoveryResetResponse({
    httpStatus: 409,
    body: { error: "Please try again" },
  })
  assert.equal(action.kind, "generic")
})

// --- submit gate -------------------------------------------------------------

test("recovery reset submit gate: requires code, strong password, and match", () => {
  const strong = "Sbd!Recover#2026"
  assert.equal(
    canSubmitRecoveryReset({ code: "123456", next: strong, confirm: strong }),
    true,
  )
  // missing code
  assert.equal(
    canSubmitRecoveryReset({ code: "  ", next: strong, confirm: strong }),
    false,
  )
  // mismatch
  assert.equal(
    canSubmitRecoveryReset({ code: "123456", next: strong, confirm: strong + "x" }),
    false,
  )
  // weak password
  assert.equal(
    canSubmitRecoveryReset({ code: "123456", next: "weak", confirm: "weak" }),
    false,
  )
})

// --- credential selector derivation -----------------------------------------

test("selectorForRecovery: Model 3/4 resolved binding -> that exact credential", () => {
  // Model 3: the typed email resolves to its own per-email binding.
  assert.deepEqual(
    selectorForRecovery({ kind: "resolved", binding: { id: "cb_per_email_B" } }),
    { bindingId: "cb_per_email_B" },
  )
  // Model 4: the current brand resolves to its own brand binding.
  assert.deepEqual(
    selectorForRecovery({ kind: "resolved", binding: { id: "cb_dewalt" } }),
    { bindingId: "cb_dewalt" },
  )
})

test("selectorForRecovery: shared-default -> null (Model 4 only, no legacy shared reset)", () => {
  assert.equal(selectorForRecovery({ kind: "shared-default" }), null)
})

test("selectorForRecovery: fails closed on ambiguous/unavailable/no-binding", () => {
  assert.equal(selectorForRecovery({ kind: "ambiguous" }), null)
  assert.equal(selectorForRecovery({ kind: "unavailable" }), null)
  assert.equal(
    selectorForRecovery({ kind: "resolved", binding: { id: "  " } }),
    null,
  )
  assert.equal(selectorForRecovery({ kind: "resolved", binding: null }), null)
})
