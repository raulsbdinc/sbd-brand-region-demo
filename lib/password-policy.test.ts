// Unit tests for the shared registration password policy. Pure; no network.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  emailUserInfoTokens,
  validateRegistrationPassword,
  PASSWORD_MIN_LENGTH,
} from "./password-policy.ts"

test("accepts a strong password with 4 classes and no email overlap", () => {
  const r = validateRegistrationPassword("Str0ng!Passphrase", ["a@example.com"])
  assert.equal(r.ok, true)
  assert.deepEqual(r.failures, [])
})

test("rejects too-short passwords", () => {
  const r = validateRegistrationPassword("Ab1!", [])
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((f) => f.includes(`${PASSWORD_MIN_LENGTH}`)))
})

test("rejects fewer than 3 character classes (lowercase + digits only)", () => {
  const r = validateRegistrationPassword("supersecret1", [])
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((f) => /3 of/.test(f)))
})

test("accepts exactly 3 of 4 character classes", () => {
  const r = validateRegistrationPassword("Supersecret1", [])
  assert.equal(r.ok, true)
})

test("emailUserInfoTokens splits the local part on delimiters (>= 3 chars)", () => {
  const tokens = emailUserInfoTokens("sbdciam-uk1-2309@mailinator.com")
  assert.ok(tokens.includes("uk1"))
  assert.ok(tokens.includes("sbdciam"))
  assert.ok(tokens.includes("2309"))
  // whole local part is included; the domain is NOT
  assert.ok(tokens.includes("sbdciam-uk1-2309"))
  assert.ok(!tokens.includes("mailinator"))
})

test("rejects a password that embeds an email user-info token (the live case)", () => {
  // "Ciam!2026UK1A" meets 'good' strength but contains "uk1" from the local part.
  const r = validateRegistrationPassword("Ciam!2026UK1A", ["sbdciam-uk1-2309@mailinator.com"])
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((f) => /email address/.test(f)))
})

test("user-info check is case-insensitive and per-email", () => {
  const r = validateRegistrationPassword("Zzz!SBDCIAM9", ["sbdciam-uk1-2309@mailinator.com"])
  assert.equal(r.ok, false)
})

test("short local-part tokens (< 3 chars) do not constrain the password", () => {
  // local part "a" is too short to be a token, so no user-info failure here.
  const r = validateRegistrationPassword("Str0ng!Passphrase", ["a@example.com"])
  assert.equal(r.ok, true)
})
