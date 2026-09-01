import { test } from "node:test"
import assert from "node:assert/strict"
import {
  planSharedLoginAlias,
  type LoginAliasCandidate,
} from "./login-alias.ts"

const SHARED = "sbd-eu"

function candidate(over: Partial<LoginAliasCandidate> = {}): LoginAliasCandidate {
  return {
    userId: "auth0|primary",
    rootEmail: "primary@example.com",
    rootEmailVerified: true,
    sharedIdentityConnections: [SHARED],
    aliasEmails: [],
    ...over,
  }
}

// --- Model 2 happy paths ----------------------------------------------------

test("verified ALTERNATE email resolves to the primary shared login", () => {
  // The live defect: alt@ is a verified alias of the sbd-eu primary, so the
  // shared password must be retried against the PRIMARY root email.
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: SHARED,
    candidates: [candidate({ aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "resolved", primaryEmail: "primary@example.com" })
})

test("alternate resolution is case/whitespace-insensitive on both sides", () => {
  const res = planSharedLoginAlias({
    typedEmail: "  ALT@Example.com ",
    sharedConnectionName: SHARED,
    candidates: [
      candidate({
        rootEmail: "Primary@Example.com",
        aliasEmails: ["Alt@example.COM"],
      }),
    ],
  })
  assert.deepEqual(res, { kind: "resolved", primaryEmail: "primary@example.com" })
})

test("typing the PRIMARY root email itself → same-as-typed (no retry)", () => {
  // Attempt 1 already tried this username against the shared realm, so a wrong
  // password here is a genuine wrong password — do NOT retry.
  const res = planSharedLoginAlias({
    typedEmail: "primary@example.com",
    sharedConnectionName: SHARED,
    candidates: [candidate({ aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "same-as-typed" })
})

// --- Fail-closed cases ------------------------------------------------------

test("unbound address (not a root or alias of any account) → none", () => {
  const res = planSharedLoginAlias({
    typedEmail: "stranger@example.com",
    sharedConnectionName: SHARED,
    candidates: [candidate({ aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("alias on an account with NO shared-connection identity → none", () => {
  // A stray alias on a non-shared (e.g. per-email/brand) record must never
  // fabricate a shared-password match.
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: SHARED,
    candidates: [
      candidate({
        sharedIdentityConnections: ["sbd-demo-per-email"],
        aliasEmails: ["alt@example.com"],
      }),
    ],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("root typed but root email UNVERIFIED → none (never trust an unverified root)", () => {
  const res = planSharedLoginAlias({
    typedEmail: "primary@example.com",
    sharedConnectionName: SHARED,
    candidates: [candidate({ rootEmailVerified: false })],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("connection-name MISMATCH (divergent constant) drops the alias → none", () => {
  // This is exactly the root cause: if the caller passes a shared name that is
  // not the one the account's identity is actually on, no match is produced.
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: "some-other-connection",
    candidates: [candidate({ aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("no configured shared connection at all → none", () => {
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: undefined,
    candidates: [candidate({ aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("empty typed email → none", () => {
  const res = planSharedLoginAlias({
    typedEmail: "   ",
    sharedConnectionName: SHARED,
    candidates: [candidate({ aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("TWO distinct shared accounts claim the same alias → ambiguous (fail closed)", () => {
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: SHARED,
    candidates: [
      candidate({ userId: "auth0|a", rootEmail: "a@example.com", aliasEmails: ["alt@example.com"] }),
      candidate({ userId: "auth0|b", rootEmail: "b@example.com", aliasEmails: ["alt@example.com"] }),
    ],
  })
  assert.deepEqual(res, { kind: "ambiguous" })
})

test("same account returned twice (two lookups) is NOT ambiguous", () => {
  const dup = candidate({ aliasEmails: ["alt@example.com"] })
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: SHARED,
    candidates: [dup, { ...dup }],
  })
  assert.deepEqual(res, { kind: "resolved", primaryEmail: "primary@example.com" })
})

test("candidate with an empty userId is ignored", () => {
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: SHARED,
    candidates: [candidate({ userId: "", aliasEmails: ["alt@example.com"] })],
  })
  assert.deepEqual(res, { kind: "none" })
})

test("account holds the shared identity AMONG others → still resolves", () => {
  const res = planSharedLoginAlias({
    typedEmail: "alt@example.com",
    sharedConnectionName: SHARED,
    candidates: [
      candidate({
        sharedIdentityConnections: ["google-oauth2-is-not-here", SHARED],
        aliasEmails: ["alt@example.com"],
      }),
    ],
  })
  assert.deepEqual(res, { kind: "resolved", primaryEmail: "primary@example.com" })
})
