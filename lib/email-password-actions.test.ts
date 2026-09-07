// Unit tests for the PURE beside-each-email password action planner (no
// framework, no network). GLSCM-4834. Run with:
//   node --test lib/email-password-actions.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  planEmailPasswordAction,
  emailPasswordActionLabel,
  shouldOfferPostVerificationPassword,
} from "./email-password-actions.ts"

const PRIMARY = "owner@primary.example"
const ALT = "alt@second.example"
const GOOGLE = "owner@gmail.com"

// ---------------------------------------------------------------------------
// UK-only visibility
// ---------------------------------------------------------------------------
test("EU (Model 1/2): every email row shows no beside-email action", () => {
  for (const email of [PRIMARY, ALT, GOOGLE]) {
    assert.equal(
      planEmailPasswordAction({
        email,
        primaryEmail: PRIMARY,
        perEmailActivationAvailable: false, // EU
        verifiedEmails: [PRIMARY, ALT, GOOGLE],
        backedPerEmailEmails: [],
      }),
      "none",
    )
  }
})

test("EU: even an email that somehow has a per-email cred shows nothing (gate wins)", () => {
  assert.equal(
    planEmailPasswordAction({
      email: ALT,
      primaryEmail: PRIMARY,
      perEmailActivationAvailable: false,
      verifiedEmails: [PRIMARY, ALT],
      backedPerEmailEmails: [ALT],
    }),
    "none",
  )
})

// ---------------------------------------------------------------------------
// UK Model 3: correct target + label per email
// ---------------------------------------------------------------------------
test("UK: a verified alternate with no password offers Set separate password", () => {
  const kind = planEmailPasswordAction({
    email: ALT,
    primaryEmail: PRIMARY,
    perEmailActivationAvailable: true,
    verifiedEmails: [PRIMARY, ALT],
    backedPerEmailEmails: [],
  })
  assert.equal(kind, "set-separate")
  assert.equal(emailPasswordActionLabel(kind), "Set separate password")
})

test("UK: an alternate that already has its own password offers Change password", () => {
  const kind = planEmailPasswordAction({
    email: ALT,
    primaryEmail: PRIMARY,
    perEmailActivationAvailable: true,
    verifiedEmails: [PRIMARY, ALT],
    backedPerEmailEmails: [ALT],
  })
  assert.equal(kind, "change")
  assert.equal(emailPasswordActionLabel(kind), "Change password")
})

test("UK: primary with NO per-email password of its own shows nothing (activation starts from the alternate)", () => {
  assert.equal(
    planEmailPasswordAction({
      email: PRIMARY,
      primaryEmail: PRIMARY,
      perEmailActivationAvailable: true,
      verifiedEmails: [PRIMARY, ALT],
      backedPerEmailEmails: [],
    }),
    "none",
  )
})

test("UK: once the pair is activated, the primary offers Change (backed check precedes the primary rule)", () => {
  assert.equal(
    planEmailPasswordAction({
      email: PRIMARY,
      primaryEmail: PRIMARY,
      perEmailActivationAvailable: true,
      verifiedEmails: [PRIMARY, ALT],
      backedPerEmailEmails: [PRIMARY, ALT],
    }),
    "change",
  )
})

test("UK: targeting is address-specific — each email decides on its OWN backed state", () => {
  const common = {
    primaryEmail: PRIMARY,
    perEmailActivationAvailable: true,
    verifiedEmails: [PRIMARY, ALT, "third@x.example"],
    backedPerEmailEmails: [ALT], // only ALT has its own password
  }
  assert.equal(planEmailPasswordAction({ ...common, email: ALT }), "change")
  assert.equal(planEmailPasswordAction({ ...common, email: "third@x.example" }), "set-separate")
  assert.equal(planEmailPasswordAction({ ...common, email: PRIMARY }), "none")
})

test("UK: an email not in the verified set shows nothing (fails closed)", () => {
  assert.equal(
    planEmailPasswordAction({
      email: "stranger@x.example",
      primaryEmail: PRIMARY,
      perEmailActivationAvailable: true,
      verifiedEmails: [PRIMARY, ALT],
      backedPerEmailEmails: [],
    }),
    "none",
  )
})

test("matching is case/whitespace-insensitive via normalizeEmail", () => {
  assert.equal(
    planEmailPasswordAction({
      email: "  ALT@Second.Example ",
      primaryEmail: "Owner@Primary.Example",
      perEmailActivationAvailable: true,
      verifiedEmails: ["owner@primary.example", "alt@second.example"],
      backedPerEmailEmails: ["ALT@SECOND.EXAMPLE"],
    }),
    "change",
  )
})

test("empty email input fails closed to none", () => {
  assert.equal(
    planEmailPasswordAction({
      email: "",
      primaryEmail: PRIMARY,
      perEmailActivationAvailable: true,
      verifiedEmails: [PRIMARY, ALT],
      backedPerEmailEmails: [],
    }),
    "none",
  )
})

test("emailPasswordActionLabel returns empty string for none", () => {
  assert.equal(emailPasswordActionLabel("none"), "")
})

// ---------------------------------------------------------------------------
// Post-verification CTA
// ---------------------------------------------------------------------------
test("UK: after verifying a fresh alternate, the post-verification CTA is offered for that exact email", () => {
  assert.equal(
    shouldOfferPostVerificationPassword({
      perEmailActivationAvailable: true,
      verifiedEmail: ALT,
      primaryEmail: PRIMARY,
    }),
    true,
  )
})

test("EU: after verifying a fresh alternate, NO post-verification password CTA (single Account password)", () => {
  assert.equal(
    shouldOfferPostVerificationPassword({
      perEmailActivationAvailable: false,
      verifiedEmail: ALT,
      primaryEmail: PRIMARY,
    }),
    false,
  )
})

test("post-verification CTA is suppressed if the verified email equals the primary", () => {
  assert.equal(
    shouldOfferPostVerificationPassword({
      perEmailActivationAvailable: true,
      verifiedEmail: PRIMARY,
      primaryEmail: PRIMARY,
    }),
    false,
  )
})

test("post-verification CTA fails closed on empty email", () => {
  assert.equal(
    shouldOfferPostVerificationPassword({
      perEmailActivationAvailable: true,
      verifiedEmail: "",
      primaryEmail: PRIMARY,
    }),
    false,
  )
})
