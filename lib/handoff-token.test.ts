import { test } from "node:test"
import assert from "node:assert/strict"
import { signHandoff, verifyHandoff } from "./handoff-token.ts"

const SECRET = "test-secret-key-abc123"
const OTHER_SECRET = "different-secret-xyz789"

interface Proof extends Record<string, unknown> {
  email: string
  primaryUserId: string
}

test("round-trips a signed payload for the matching purpose", () => {
  const token = signHandoff<Proof>(
    "model4-proof",
    { email: "jane@example.com", primaryUserId: "auth0|1" },
    SECRET,
    1_000,
  )
  const r = verifyHandoff<Proof>(token, "model4-proof", SECRET, {
    maxAgeMs: 60_000,
    now: 1_500,
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.data.email, "jane@example.com")
    assert.equal(r.data.primaryUserId, "auth0|1")
    assert.equal(r.iat, 1_000)
  }
})

test("missing token fails closed", () => {
  assert.deepEqual(verifyHandoff(undefined, "google-link", SECRET), {
    ok: false,
    reason: "missing",
  })
  assert.deepEqual(verifyHandoff("", "google-link", SECRET), {
    ok: false,
    reason: "missing",
  })
})

test("a token minted for another purpose cannot be replayed", () => {
  const token = signHandoff("model3-complete", { email: "a@b.com" }, SECRET, 0)
  const r = verifyHandoff(token, "google-link", SECRET, { maxAgeMs: 60_000, now: 10 })
  assert.deepEqual(r, { ok: false, reason: "purpose-mismatch" })
})

test("tampered body is rejected (signature mismatch)", () => {
  const token = signHandoff("model4-proof", { email: "jane@example.com" }, SECRET, 0)
  const dot = token.lastIndexOf(".")
  const forgedBody = Buffer.from(
    JSON.stringify({ purpose: "model4-proof", iat: 0, data: { email: "attacker@evil.com" } }),
    "utf8",
  ).toString("base64url")
  const forged = `${forgedBody}.${token.slice(dot + 1)}`
  assert.deepEqual(verifyHandoff(forged, "model4-proof", SECRET, { maxAgeMs: 60_000, now: 10 }), {
    ok: false,
    reason: "bad-signature",
  })
})

test("a token signed with a different secret is rejected", () => {
  const token = signHandoff("google-link", { email: "jane@example.com" }, OTHER_SECRET, 0)
  assert.deepEqual(verifyHandoff(token, "google-link", SECRET, { maxAgeMs: 60_000, now: 10 }), {
    ok: false,
    reason: "bad-signature",
  })
})

test("an expired token is rejected", () => {
  const token = signHandoff("model3-complete", { email: "jane@example.com" }, SECRET, 0)
  assert.deepEqual(
    verifyHandoff(token, "model3-complete", SECRET, { maxAgeMs: 1_000, now: 2_000 }),
    { ok: false, reason: "expired" },
  )
})

test("a token exactly at the age boundary is still valid", () => {
  const token = signHandoff("model3-complete", { email: "jane@example.com" }, SECRET, 0)
  const r = verifyHandoff(token, "model3-complete", SECRET, { maxAgeMs: 1_000, now: 1_000 })
  assert.equal(r.ok, true)
})

test("malformed tokens fail closed", () => {
  assert.deepEqual(verifyHandoff("no-dot-here", "google-link", SECRET), {
    ok: false,
    reason: "malformed",
  })
  // Valid signature over a non-JSON body.
  const badBody = "not-base64-json"
  const r = verifyHandoff(`${badBody}.x`, "google-link", SECRET, { maxAgeMs: 60_000 })
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.reason === "bad-signature" || r.reason === "malformed")
})

test("empty secret fails closed on verify", () => {
  const token = signHandoff("google-link", { email: "jane@example.com" }, SECRET, 0)
  assert.deepEqual(verifyHandoff(token, "google-link", "", { maxAgeMs: 60_000, now: 10 }), {
    ok: false,
    reason: "bad-signature",
  })
})
