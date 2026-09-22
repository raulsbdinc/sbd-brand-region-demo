// Tests for the PURE storefront Create Account drawer routing brain. These lock
// the contract the one shared drawer relies on: which market uses the per-brand
// flow, the correct partner brand + copy for a UK cross-brand collision, and the
// mapping of every per-brand endpoint response to a drawer action. No network,
// no Auth0 — just the decision table.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  crossBrandCollisionMessage,
  drawerSignupFlow,
  interpretBrandProofResponse,
  interpretBrandSignupResponse,
  interpretPerEmailCodeStart,
  interpretPerEmailCreateResponse,
  otherUkBrand,
} from "./drawer-signup.ts"

// --- Which storefront posts where -------------------------------------------

test("drawerSignupFlow: DeWalt UK is per-email, Stanley UK is per-brand, EU stays shared", () => {
  assert.equal(drawerSignupFlow("uk", "dewalt"), "per-email")
  assert.equal(drawerSignupFlow("uk", "stanley"), "per-brand")
  // France/Germany (Models 1/2) keep the untouched shared signup, on either brand.
  assert.equal(drawerSignupFlow("fr", "dewalt"), "shared")
  assert.equal(drawerSignupFlow("de", "stanley"), "shared")
  assert.equal(drawerSignupFlow("us", "dewalt"), "shared")
  // A UK brand with no brand connection fails closed to shared.
  assert.equal(drawerSignupFlow("uk", "craftsman"), "shared")
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

// --- /api/registration/per-email response interpretation --------------------

test("interpretPerEmailCodeStart: code-sent / not-configured / error", () => {
  assert.deepEqual(
    interpretPerEmailCodeStart({ httpStatus: 200, body: { status: "code-sent" } }),
    { kind: "code-sent" },
  )
  assert.deepEqual(
    interpretPerEmailCodeStart({ httpStatus: 200, body: { configured: false } }),
    { kind: "not-configured" },
  )
  assert.deepEqual(
    interpretPerEmailCodeStart({ httpStatus: 400, body: { error: "Enter a valid email address." } }),
    { kind: "error", message: "Enter a valid email address." },
  )
})

// Regression (live bug): a DeWalt UK signup for an email that ALREADY owns the
// other UK brand (Stanley) must NOT fall through to a generic error and must NOT
// mint a second per-email user. The verify/start route returns a 200
// { status: "cross-brand-required" }; the interpreter maps it to the SAME
// proof-required action the per-brand (Stanley) drawer already handles, so the
// drawer diverts into the cross-brand proof step and this becomes a second brand
// password on the one existing account.
test("interpretPerEmailCodeStart: cross-brand-required maps to the proof step (no second user)", () => {
  // Mailbox is a known owned address → email-code proof is offered too.
  assert.deepEqual(
    interpretPerEmailCodeStart({
      httpStatus: 200,
      body: { status: "cross-brand-required", proofOptions: ["password", "email-code"] },
    }),
    { kind: "proof-required", canEmailCode: true },
  )
  // Only password proof offered → still proof-required, just no email-code.
  assert.deepEqual(
    interpretPerEmailCodeStart({
      httpStatus: 200,
      body: { status: "cross-brand-required", proofOptions: ["password"] },
    }),
    { kind: "proof-required", canEmailCode: false },
  )
  // Missing/absent proofOptions is treated as no email-code, never an error.
  assert.deepEqual(
    interpretPerEmailCodeStart({
      httpStatus: 200,
      body: { status: "cross-brand-required" },
    }),
    { kind: "proof-required", canEmailCode: false },
  )
})

test("interpretPerEmailCreateResponse: created only after the code is consumed", () => {
  assert.deepEqual(
    interpretPerEmailCreateResponse({ httpStatus: 201, body: { status: "created" } }),
    { kind: "created" },
  )
  assert.deepEqual(
    interpretPerEmailCreateResponse({ httpStatus: 401, body: { error: "That code isn't right." } }),
    { kind: "bad-code" },
  )
  assert.deepEqual(
    interpretPerEmailCreateResponse({ httpStatus: 200, body: { configured: false } }),
    { kind: "not-configured" },
  )
})
