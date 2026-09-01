import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isStandaloneVerifiedGoogle,
  planGoogleReconcile,
  type GoogleSessionFacts,
  type ReconcileContext,
} from "./google-reconcile.ts"

function google(over: Partial<GoogleSessionFacts> = {}): GoogleSessionFacts {
  return {
    sub: "google-oauth2|abc",
    email: "person@example.com",
    emailVerified: true,
    identityCount: 1,
    soleProvider: "google-oauth2",
    ...over,
  }
}

function ctx(over: Partial<ReconcileContext> = {}): ReconcileContext {
  return {
    managementConfigured: true,
    google: google(),
    existing: { kind: "single", auth0UserId: "auth0|primary" },
    ...over,
  }
}

test("isStandaloneVerifiedGoogle: accepts a lone verified Google record", () => {
  assert.equal(isStandaloneVerifiedGoogle(google()), true)
})

test("isStandaloneVerifiedGoogle: rejects unverified / multi-identity / non-google", () => {
  assert.equal(isStandaloneVerifiedGoogle(google({ emailVerified: false })), false)
  assert.equal(isStandaloneVerifiedGoogle(google({ identityCount: 2 })), false)
  assert.equal(isStandaloneVerifiedGoogle(google({ soleProvider: "auth0" })), false)
  assert.equal(isStandaloneVerifiedGoogle(google({ sub: "auth0|x" })), false)
  assert.equal(isStandaloneVerifiedGoogle(google({ email: "" })), false)
})

test("collision with a DIFFERENT account → require-proof (never links on match)", () => {
  const d = planGoogleReconcile(ctx())
  assert.equal(d.action, "require-proof")
  if (d.action === "require-proof") {
    assert.equal(d.primaryUserId, "auth0|primary")
    assert.equal(d.email, "person@example.com")
  }
})

test("email is normalized in the require-proof decision", () => {
  const d = planGoogleReconcile(
    ctx({ google: google({ email: "  Person@Example.COM " }) }),
  )
  assert.equal(d.action === "require-proof" && d.email, "person@example.com")
})

test("ambiguous existing accounts → fail closed, never link", () => {
  const d = planGoogleReconcile(ctx({ existing: { kind: "ambiguous" } }))
  assert.deepEqual(d, { action: "fail-closed", reason: "ambiguous" })
})

test("directory lookup unavailable → fail closed", () => {
  const d = planGoogleReconcile(ctx({ existing: { kind: "unavailable" } }))
  assert.deepEqual(d, { action: "fail-closed", reason: "lookup-unavailable" })
})

test("no existing account → proceed (Google is the only holder)", () => {
  const d = planGoogleReconcile(ctx({ existing: { kind: "none" } }))
  assert.equal(d.action, "proceed")
})

test("the lone owner IS this Google record → proceed (self)", () => {
  const d = planGoogleReconcile(
    ctx({ existing: { kind: "single", auth0UserId: "google-oauth2|abc" } }),
  )
  assert.equal(d.action === "proceed" && d.reason, "self")
})

test("unverified Google email → proceed, never matched", () => {
  const d = planGoogleReconcile(ctx({ google: google({ emailVerified: false }) }))
  assert.equal(d.action, "proceed")
  assert.equal(d.action === "proceed" && d.reason, "email-unverified")
})

test("already-linked (multi-identity) Google session → proceed", () => {
  const d = planGoogleReconcile(
    ctx({ google: google({ identityCount: 2 }) }),
  )
  assert.equal(d.action === "proceed" && d.reason, "already-linked")
})

test("a non-Google session is left untouched", () => {
  const d = planGoogleReconcile(ctx({ google: google({ sub: "auth0|x" }) }))
  assert.equal(d.action === "proceed" && d.reason, "not-google")
})

test("no session at all → proceed", () => {
  const d = planGoogleReconcile(
    ctx({ google: google({ sub: "" }) }),
  )
  assert.equal(d.action === "proceed" && d.reason, "no-session")
})

test("management off → proceed even with a would-be collision", () => {
  const d = planGoogleReconcile(ctx({ managementConfigured: false }))
  assert.equal(d.action === "proceed" && d.reason, "management-off")
})

test("management on but existing lookup says configured-off → proceed", () => {
  const d = planGoogleReconcile(ctx({ existing: { kind: "configured-off" } }))
  assert.equal(d.action === "proceed" && d.reason, "management-off")
})

// --- Defect 2 live-scenario mapping -----------------------------------------
// These assert the exact reported flows. The NEW behaviour behind them lives in
// resolveExistingAccountByEmail (a verified ALTERNATE email now resolves to its
// owning primary as kind:"single"); once it does, the planner routes as below.

test("Defect 2: signed-out Google whose email is a VERIFIED ALTERNATE of a primary → require-proof then link", () => {
  // resolveExistingAccountByEmail matched the Gmail alternate to the primary and
  // returned kind:"single" for a DIFFERENT account than the standalone Google.
  const d = planGoogleReconcile(
    ctx({
      google: google({ sub: "google-oauth2|dup", email: "alt@gmail.com" }),
      existing: { kind: "single", auth0UserId: "auth0|primary" },
    }),
  )
  assert.equal(d.action, "require-proof")
  assert.equal(d.action === "require-proof" && d.primaryUserId, "auth0|primary")
})

test("Defect 2: repeat Google login after linking returns the SAME primary (idempotent, no new duplicate)", () => {
  // Second time around the Google identity is linked onto the primary, so the
  // session carries >1 identity → proceed as the (primary) account, no relink.
  const d = planGoogleReconcile(ctx({ google: google({ identityCount: 2 }) }))
  assert.equal(d.action === "proceed" && d.reason, "already-linked")
})

test("Defect 2: a Google identity already attached elsewhere is never re-linked", () => {
  // Ambiguous ownership must fail closed — never steal a Google identity from
  // another customer.
  const d = planGoogleReconcile(ctx({ existing: { kind: "ambiguous" } }))
  assert.deepEqual(d, { action: "fail-closed", reason: "ambiguous" })
})
