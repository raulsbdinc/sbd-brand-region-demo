import test from "node:test"
import assert from "node:assert/strict"
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS_TEXT,
  newPasswordChecklist,
  passwordMinLength,
  passwordRequirementsText,
  validatePassword,
  validateRegistrationPassword,
} from "./password-policy.ts"
import { validateNewPassword } from "./password-change.ts"

const MARKETS = ["fr", "de", "uk", undefined] as const
const EMAIL = "maple.tester@example.com"

function acceptedEverywhere(pw: string, emails: string[] = []) {
  for (const m of MARKETS) {
    assert.equal(validateRegistrationPassword(pw, emails, m).ok, true, `registration ${m}: ${pw}`)
    assert.equal(validateNewPassword(pw, m, emails).ok, true, `change ${m}: ${pw}`)
  }
}

function refusedEverywhere(pw: string, expected: string) {
  for (const m of MARKETS) {
    const r = validateRegistrationPassword(pw, [], m)
    assert.equal(r.ok, false, `registration ${m}: ${pw}`)
    assert.ok(r.failures.some((f) => f.includes(expected)), `${m}: ${r.failures.join(" | ")}`)
    assert.equal(validateNewPassword(pw, m).ok, false, `change ${m}: ${pw}`)
  }
}

test("one rule: minimum 8 and identical text on every market", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8)
  for (const m of MARKETS) {
    assert.equal(passwordMinLength(m), 8)
    assert.equal(passwordRequirementsText(m), PASSWORD_REQUIREMENTS_TEXT)
  }
  assert.match(PASSWORD_REQUIREMENTS_TEXT, /Numbers are optional/)
  assert.doesNotMatch(PASSWORD_REQUIREMENTS_TEXT, /15|three of|3 of/i)
  assert.doesNotMatch(PASSWORD_REQUIREMENTS_TEXT, /\u2014/)
})

test("exactly 8 characters, upper+lower+special, NO digit, is accepted", () => {
  assert.equal("Maple!ab".length, 8)
  acceptedEverywhere("Maple!ab")
})

test("longer valid passwords and extra characters are accepted", () => {
  acceptedEverywhere("Maple!ab-and-a-much-longer-tail 2026")
  acceptedEverywhere("Ünïcödé!Pass word") // non-ASCII extras allowed
  acceptedEverywhere("Aa!" + "x".repeat(PASSWORD_MAX_BYTES - 3)) // exactly 72 bytes
})

test("passwords containing email or name substrings are accepted", () => {
  acceptedEverywhere("Maple.Tester!", [EMAIL])
  acceptedEverywhere("maple.tester@example.com!A", [EMAIL])
  acceptedEverywhere("Example!Raul", [EMAIL])
})

test("seven characters are refused", () => {
  assert.equal("Maple!a".length, 7)
  refusedEverywhere("Maple!a", "At least 8 characters")
})

test("missing uppercase is refused even with lowercase+digit+special", () => {
  refusedEverywhere("maple!ab12", "uppercase")
})

test("missing lowercase is refused even with uppercase+digit+special", () => {
  refusedEverywhere("MAPLE!AB12", "lowercase")
})

test("missing special is refused even with uppercase+lowercase+digit", () => {
  refusedEverywhere("MapleAb12", "special")
})

test("three-of-four is NOT enough when special is the missing class", () => {
  // upper + lower + number = 3 of 4 classes, still refused
  assert.equal(validatePassword("Abcdefg1").ok, false)
})

test("over 72 bytes is refused, never truncated", () => {
  const long = "Aa!" + "x".repeat(PASSWORD_MAX_BYTES - 2)
  const r = validatePassword(long)
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((f) => f.includes("72 bytes")))
})

test("passwords are not trimmed: surrounding spaces count as characters", () => {
  // 7 visible chars + a space = 8 characters, space is a special character.
  assert.equal(validatePassword("Maplexa ").ok, true)
  assert.equal(validatePassword(" Maple!a").ok, true)
})

test("non-string input is refused", () => {
  assert.equal(validatePassword(undefined).ok, false)
  assert.equal(validatePassword(12345678).ok, false)
})

test("checklist shows the four rules and ticks them independently", () => {
  const rows = newPasswordChecklist("Maple!ab", "uk")
  assert.equal(rows.length, 4)
  assert.ok(rows.every((r) => r.ok))
  const partial = newPasswordChecklist("maple", "fr")
  assert.deepEqual(
    partial.map((r) => r.ok),
    [false, true, false, false],
  )
  assert.equal(newPasswordChecklist("", "de").every((r) => !r.ok), true)
})
