import { test } from "node:test"
import assert from "node:assert/strict"
import { recoveryHref, runForgotPasswordNavigation } from "./recovery-href.ts"

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

// Regression for the production bug where clicking "Forgot password?" navigated
// to /recover but left the sign-in drawer mounted on top, blocking the page.
// The action must CLOSE the drawer AND navigate (preserving the encoded email),
// and must NOT submit a recovery request.

test("forgot-password navigation closes the drawer and preserves the encoded email", () => {
  const calls: string[] = []
  let navigatedTo: string | null = null

  const href = runForgotPasswordNavigation("jane@example.com", {
    close: () => calls.push("close"),
    navigate: (to) => {
      calls.push("navigate")
      navigatedTo = to
    },
  })

  // Both effects fired: the drawer was closed and a navigation happened.
  assert.deepEqual(calls, ["close", "navigate"], "drawer must close before navigating")
  // The email survives as an encoded prefill param (server-side prefill intact).
  assert.equal(navigatedTo, "/recover?email=jane%40example.com")
  assert.equal(href, "/recover?email=jane%40example.com")
})

test("forgot-password navigation still closes the drawer when the email is blank", () => {
  const calls: string[] = []
  let navigatedTo: string | null = null

  runForgotPasswordNavigation("   ", {
    close: () => calls.push("close"),
    navigate: (to) => {
      calls.push("navigate")
      navigatedTo = to
    },
  })

  assert.deepEqual(calls, ["close", "navigate"])
  // No junk forwarded, but navigation to the recovery page still occurs.
  assert.equal(navigatedTo, "/recover")
})

test("forgot-password navigation cannot submit a recovery request (close + navigate only)", () => {
  // The orchestrator's only side effects are the two handlers it is given.
  // There is no submit/fetch dependency, so switching to recovery can never
  // fire a network call. We assert the contract structurally: exactly the two
  // provided callbacks run, nothing else.
  let closeCount = 0
  let navigateCount = 0

  runForgotPasswordNavigation("jane@example.com", {
    close: () => {
      closeCount += 1
    },
    navigate: () => {
      navigateCount += 1
    },
  })

  assert.equal(closeCount, 1)
  assert.equal(navigateCount, 1)
})
