import { test } from "node:test"
import assert from "node:assert/strict"
import { recoveryHref } from "./recovery-href.ts"

// Regression guard for the drawer's "Forgot password?" control. The button
// itself is exercised in-browser; this locks the pure target-building logic so
// the link can never silently regress to a no-op or start forwarding junk.

test("recoveryHref carries a valid email as an encoded prefill param", () => {
  assert.equal(recoveryHref("jane@example.com"), "/recover?email=jane%40example.com")
})

test("recoveryHref trims surrounding whitespace before encoding", () => {
  assert.equal(recoveryHref("  jane@example.com  "), "/recover?email=jane%40example.com")
})

test("recoveryHref URL-encodes reserved characters like +", () => {
  assert.equal(
    recoveryHref("jane+promo@example.com"),
    "/recover?email=jane%2Bpromo%40example.com",
  )
})

test("recoveryHref omits the param when the email is empty", () => {
  assert.equal(recoveryHref(""), "/recover")
  assert.equal(recoveryHref("   "), "/recover")
})

test("recoveryHref omits the param when the email is malformed", () => {
  assert.equal(recoveryHref("not-an-email"), "/recover")
  assert.equal(recoveryHref("jane@"), "/recover")
  assert.equal(recoveryHref("@example.com"), "/recover")
  assert.equal(recoveryHref("jane@example"), "/recover")
})
