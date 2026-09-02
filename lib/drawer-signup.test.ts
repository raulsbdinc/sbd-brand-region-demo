// Tests for the PURE storefront Create Account drawer routing brain. These lock
// the contract the one shared drawer relies on: which market uses the per-brand
// flow, the correct partner brand + copy for a UK cross-brand collision, and the
// mapping of every per-brand endpoint response to a drawer action. No network,
// no Auth0 — just the decision table.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  crossBrandCollisionMessage,
  interpretBrandProofResponse,
  interpretBrandSignupResponse,
  otherUkBrand,
  signupUsesBrandFlow,
} from "./drawer-signup.ts"

// --- Which market uses the per-brand flow -----------------------------------

test("signupUsesBrandFlow: only UK routes the drawer to the per-brand endpoint", () => {
  assert.equal(signupUsesBrandFlow("uk"), true)
  // France/Germany (Models 1/2) keep the untouched shared signup.
  assert.equal(signupUsesBrandFlow("fr"), false)
  assert.equal(signupUsesBrandFlow("de"), false)
  assert.equal(signupUsesBrandFlow("us"), false)
})

// --- Partner brand + collision copy, both directions ------------------------

test("otherUkBrand: DeWalt ⇄ Stanley, null for any non-UK brand", () => {
  assert.equal(otherUkBrand("dewalt"), "stanley")
  assert.equal(otherUkBrand("stanley"), "dewalt")
  assert.equal(otherUkBrand("craftsman"), null)
})

test("crossBrandCollisionMessage: names the OTHER brand from each storefront", () => {
  const onDeWalt = crossBrandCollisionMessage("dewalt")
  assert.ok(onDeWalt)
  assert.match(onDeWalt as string, /already has a Stanley account\./)
  assert.match(onDeWalt as string, /add DeWalt —/)

  const onStanley = crossBrandCollisionMessage("stanley")
  assert.ok(onStanley)
  assert.match(onStanley as string, /already has a DeWalt account\./)
  assert.match(onStanley as string, /add Stanley —/)

  // No UK partner brand → no message (fails closed, never invents a partner).
  assert.equal(crossBrandCollisionMessage("craftsman"), null)
})

// --- /api/registration/brand response interpretation ------------------------

test("interpretBrandSignupResponse: new UK signup → created", () => {
  assert.deepEqual(
    interpretBrandSignupResponse({ httpStatus: 201, body: { status: "created" } }),
    { kind: "created" },
  )
})

test("interpretBrandSignupResponse: same email owns the other brand → proof-required (email-code offered)", () => {
  assert.deepEqual(
    interpretBrandSignupResponse({
      httpStatus: 200,
      body: { status: "proof-required", proofOptions: ["password", "email-code"] },
    }),
    { kind: "proof-required", canEmailCode: true },
  )
  // Password-only offer still routes to proof but flags no email code.
  assert.deepEqual(
    interpretBrandSignupResponse({
      httpStatus: 200,
      body: { status: "proof-required", proofOptions: ["password"] },
    }),
    { kind: "proof-required", canEmailCode: false },
  )
})

test("interpretBrandSignupResponse: current brand already exists → brand-exists (never a duplicate)", () => {
  assert.deepEqual(
    interpretBrandSignupResponse({
      httpStatus: 409,
      body: { error: "An account already exists for this brand. Try signing in instead.", reason: "already-brand" },
    }),
    { kind: "brand-exists" },
  )
})

test("interpretBrandSignupResponse: not configured / neutral errors", () => {
  assert.deepEqual(
    interpretBrandSignupResponse({ httpStatus: 200, body: { configured: false, reason: "not-configured" } }),
    { kind: "not-configured" },
  )
  // A neutral 409 (ambiguous / model conflict) is a plain error, NOT brand-exists.
  assert.deepEqual(
    interpretBrandSignupResponse({
      httpStatus: 409,
      body: { error: "We couldn't complete that right now. Please try again." },
    }),
    { kind: "error", message: "We couldn't complete that right now. Please try again." },
  )
  assert.deepEqual(
    interpretBrandSignupResponse({ httpStatus: 400, body: { error: "Use at least 8 characters." } }),
    { kind: "error", message: "Use at least 8 characters." },
  )
})

// --- /api/registration/brand/proof response interpretation ------------------

test("interpretBrandProofResponse: linked / bad-code / not-configured / error", () => {
  assert.deepEqual(
    interpretBrandProofResponse({ httpStatus: 201, body: { status: "linked" } }),
    { kind: "linked" },
  )
  assert.deepEqual(
    interpretBrandProofResponse({ httpStatus: 401, body: { error: "That code isn't right." } }),
    { kind: "bad-code" },
  )
  assert.deepEqual(
    interpretBrandProofResponse({ httpStatus: 200, body: { configured: false } }),
    { kind: "not-configured" },
  )
  assert.deepEqual(
    interpretBrandProofResponse({ httpStatus: 502, body: { error: "Please try again." } }),
    { kind: "error", message: "Please try again." },
  )
})
