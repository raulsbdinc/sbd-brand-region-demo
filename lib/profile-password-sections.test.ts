// GLSCM-4834 follow-up — account-aware profile password-section resolution.
// The bug: presentation was inferred from the storefront host, so a Model 4
// account opened on DeWalt UK saw no Brand passwords section (and the wrong
// "one password" welcome copy). These tests pin the account-aware rules.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  accountCredentialFactsFromMethods,
  resolveProfilePasswordSections,
  planSignInPasswordRows,
  resolveSignInPasswordDisplay,
} from "./brand-password-actions.ts"
import {
  planPerEmailPasswordControls,
  emailPasswordActionAriaLabel,
} from "./email-password-actions.ts"

// Host-gate shorthands for the two UK storefronts and EU.
const DEWALT_UK = { hostPerEmailModel: true, hostPerBrandModel: false }
const STANLEY_UK = { hostPerEmailModel: false, hostPerBrandModel: true }
const EU = { hostPerEmailModel: false, hostPerBrandModel: false }

const NO_CREDS = { hasPerEmailCredentials: false, hasBrandCredentials: false }
const BRAND_CREDS = { hasPerEmailCredentials: false, hasBrandCredentials: true }
const PER_EMAIL_CREDS = { hasPerEmailCredentials: true, hasBrandCredentials: false }
// A canonical Model 3 account: its per-email credential co-exists with the
// brand DB credential it was provisioned against, so BOTH facts are true.
const PER_EMAIL_AND_BRAND_CREDS = {
  hasPerEmailCredentials: true,
  hasBrandCredentials: true,
}

// --- accountCredentialFactsFromMethods --------------------------------------

test("facts: brand connection keys mark a Model 4 account", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "dewalt" },
    { kind: "password", connectionKey: "stanley" },
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: false,
    hasBrandCredentials: true,
  })
})

test("facts: a single brand credential still marks brand creds", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "stanley" },
  ])
  assert.equal(facts.hasBrandCredentials, true)
  assert.equal(facts.hasPerEmailCredentials, false)
})

test("facts: per-email connection key marks a Model 3 account", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "per-email" },
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: true,
    hasBrandCredentials: false,
  })
})

test("facts: shared password and non-password rows are neither model", () => {
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "shared" },
    { kind: "passkey", connectionKey: "dewalt" }, // non-password ignored
    { kind: "social" },
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: false,
    hasBrandCredentials: false,
  })
})

// --- Model 4 account: brand section on BOTH UK storefronts ------------------

test("Model 4 account on DeWalt UK shows the Brand section, not per-email", () => {
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts: BRAND_CREDS })
  assert.equal(s.showBrandSection, true) // the core bug fix
  assert.equal(s.showPerEmailActions, false)
})

test("Model 4 account on Stanley UK shows the Brand section", () => {
  const s = resolveProfilePasswordSections({ ...STANLEY_UK, facts: BRAND_CREDS })
  assert.equal(s.showBrandSection, true)
  assert.equal(s.showPerEmailActions, false)
})

// --- Overlap: canonical Model 3 that ALSO holds a brand DB credential -------
// Real regression (giledos375@bowlfuel.com on DeWalt UK): a per-email account
// naturally carries a DeWalt DB credential too, so facts were {true,true} and
// the resolver wrongly rendered BOTH per-email actions AND a Brand section with
// "Change DeWalt password". Per-email must win the overlap.

test("overlap {perEmail:true, brand:true} on DeWalt UK is Model 3 only", () => {
  const s = resolveProfilePasswordSections({
    ...DEWALT_UK,
    facts: PER_EMAIL_AND_BRAND_CREDS,
  })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false) // the fix: no Brand section
})

test("overlap {perEmail:true, brand:true} on Stanley UK exposes neither", () => {
  // Per-email never leaks onto Stanley UK; and per-email winning means the
  // brand section stays hidden for this Model 3 account there too.
  const s = resolveProfilePasswordSections({
    ...STANLEY_UK,
    facts: PER_EMAIL_AND_BRAND_CREDS,
  })
  assert.equal(s.showPerEmailActions, false)
  assert.equal(s.showBrandSection, false)
})

test("giledos login-method shape resolves to Model 3 on DeWalt UK", () => {
  // Mirrors the real account: primary + secondary per-email credentials plus
  // the DeWalt DB credential they were provisioned against.
  const facts = accountCredentialFactsFromMethods([
    { kind: "password", connectionKey: "per-email" }, // giledos375@bowlfuel.com
    { kind: "password", connectionKey: "per-email" }, // fatrazigna@necub.com
    { kind: "password", connectionKey: "dewalt" }, // canonical brand DB credential
  ])
  assert.deepEqual(facts, {
    hasPerEmailCredentials: true,
    hasBrandCredentials: true,
  })
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false)
})

// --- Model 3 account: per-email preserved on DeWalt UK ----------------------

test("Model 3 account on DeWalt UK keeps per-email actions, no brand section", () => {
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts: PER_EMAIL_CREDS })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false)
})

test("Model 3 account on Stanley UK exposes neither model's controls", () => {
  // Per-email must never leak onto Stanley UK, and a per-email account must not
  // be offered a brand set (that would mix models at the backend).
  const s = resolveProfilePasswordSections({ ...STANLEY_UK, facts: PER_EMAIL_CREDS })
  assert.equal(s.showPerEmailActions, false)
  assert.equal(s.showBrandSection, false)
})

// --- Fresh accounts keep the host default -----------------------------------

test("fresh account on DeWalt UK defaults to per-email actions", () => {
  const s = resolveProfilePasswordSections({ ...DEWALT_UK, facts: NO_CREDS })
  assert.equal(s.showPerEmailActions, true)
  assert.equal(s.showBrandSection, false)
})

test("fresh account on Stanley UK defaults to the Brand section", () => {
  const s = resolveProfilePasswordSections({ ...STANLEY_UK, facts: NO_CREDS })
  assert.equal(s.showBrandSection, true)
  assert.equal(s.showPerEmailActions, false)
})

// --- EU Models 1/2 never change ---------------------------------------------

test("EU shows neither section regardless of account facts", () => {
  for (const facts of [NO_CREDS, BRAND_CREDS, PER_EMAIL_CREDS]) {
    const s = resolveProfilePasswordSections({ ...EU, facts })
    assert.equal(s.showPerEmailActions, false)
    assert.equal(s.showBrandSection, false)
  }
})

// --- Model 3 single-source: exactly one control per email, no duplicates ----
// Real regression (giledos375@bowlfuel.com on DeWalt UK): the DOM had FIVE
// "Change password" buttons — one beside each of the two emails PLUS three more
// in "How you sign in" (a spurious "DeWalt password" row and a Password row per
// email). Model 3 password management must be single-source: the actionable
// controls live ONLY beside each email, and the sign-in list collapses to one
// non-action summary row.

// Mirrors the real giledos account: primary + verified secondary, both with
// their own per-email password.
const GILEDOS = {
  primaryEmail: "giledos375@bowlfuel.com",
  perEmailActivationAvailable: true,
  verifiedEmails: ["giledos375@bowlfuel.com", "fatrazigna@necub.com"],
  backedPerEmailEmails: ["giledos375@bowlfuel.com", "fatrazigna@necub.com"],
}

test("giledos Model 3 yields exactly two actionable password controls", () => {
  const controls = planPerEmailPasswordControls(GILEDOS)
  assert.equal(controls.length, 2)
  for (const c of controls) {
    assert.equal(c.kind, "change")
    assert.equal(c.label, "Change password") // compact visible label
  }
})

test("giledos per-email controls carry exact per-email accessible names", () => {
  const controls = planPerEmailPasswordControls(GILEDOS)
  const byEmail = new Map(controls.map((c) => [c.email, c.ariaLabel]))
  assert.equal(
    byEmail.get("giledos375@bowlfuel.com"),
    "Change password for giledos375@bowlfuel.com",
  )
  assert.equal(
    byEmail.get("fatrazigna@necub.com"),
    "Change password for fatrazigna@necub.com",
  )
})

test("a not-yet-activated alternate offers Set separate password with exact name", () => {
  const controls = planPerEmailPasswordControls({
    ...GILEDOS,
    backedPerEmailEmails: ["giledos375@bowlfuel.com"], // secondary not activated
  })
  const secondary = controls.find((c) => c.email === "fatrazigna@necub.com")
  assert.ok(secondary)
  assert.equal(secondary?.kind, "set-separate")
  assert.equal(secondary?.label, "Set separate password")
  assert.equal(
    secondary?.ariaLabel,
    "Set separate password for fatrazigna@necub.com",
  )
})

test("aria-label helper always names the exact email; none => empty", () => {
  assert.equal(
    emailPasswordActionAriaLabel("change", "a@x.com"),
    "Change password for a@x.com",
  )
  assert.equal(
    emailPasswordActionAriaLabel("set-separate", "b@y.com"),
    "Set separate password for b@y.com",
  )
  assert.equal(emailPasswordActionAriaLabel("none", "c@z.com"), "")
})

test("sign-in list collapses to one non-action Email passwords summary row (Model 3)", () => {
  const rows = planSignInPasswordRows({ perEmailManaged: true })
  assert.equal(rows.mode, "summary")
  assert.equal(rows.name, "Email passwords")
  assert.equal(rows.line, "Managed beside each email address above.")
  // The summary shape carries no per-credential rows and thus no brand label:
  // there is no way to render a "DeWalt password" change action from it.
  assert.equal(JSON.stringify(rows).includes("password for"), false)
})

test("sign-in list keeps per-credential rows when per-email is NOT managed", () => {
  const rows = planSignInPasswordRows({ perEmailManaged: false })
  assert.equal(rows.mode, "credentials")
})

// --- Sign-in password DISPLAY: the actual render-path decision --------------
// Real regression (giledos375 on the latest DeWalt UK preview): the profile
// computed showPerEmailActions correctly, but the sign-in section did NOT
// forward the flag to the password-credential list, so a Model 3 account still
// rendered raw per-credential rows (including a "DeWalt password" row). The
// render path now derives the summary-vs-credentials decision from BOTH the
// (possibly-unforwarded) flag AND the account's own login-methods, so the list
// can never expand a Model 3 account into per-credential rows. These tests
// exercise that exact decision function with the live method shapes.

// The real giledos login-methods payload the sign-in list renders from.
const GILEDOS_METHODS = [
  { kind: "password", connectionKey: "per-email" }, // giledos375@bowlfuel.com
  { kind: "password", connectionKey: "per-email" }, // fatrazigna@necub.com
  { kind: "password", connectionKey: "dewalt" }, // canonical brand DB credential
]

test("display: forwarded per-email flag summarizes without needing methods", () => {
  const d = resolveSignInPasswordDisplay({
    perEmailManaged: true,
    methodsLoaded: false,
    methods: [],
  })
  assert.equal(d, "summary")
})

test("display: giledos methods summarize even when the flag is NOT forwarded", () => {
  // This is the exact live failure: perEmailManaged reaches the list as false
  // (wiring omission), yet the account genuinely manages passwords per-email.
  // The list must still collapse to the summary — never per-credential rows.
  const d = resolveSignInPasswordDisplay({
    perEmailManaged: false,
    methodsLoaded: true,
    methods: GILEDOS_METHODS,
  })
  assert.equal(d, "summary")
})

test("display: no 'DeWalt password' row is reachable for a Model 3 account", () => {
  // With the flag dropped, the ONLY thing standing between the account and a
  // spurious brand-DB "DeWalt password" row is this decision. Prove it collapses
  // to the summary, whose content carries no brand credential label.
  const d = resolveSignInPasswordDisplay({
    perEmailManaged: false,
    methodsLoaded: true,
    methods: GILEDOS_METHODS,
  })
  assert.equal(d, "summary")
  const summary = planSignInPasswordRows({ perEmailManaged: true })
  assert.equal(summary.mode, "summary")
  assert.equal(JSON.stringify(summary).toLowerCase().includes("dewalt"), false)
})

test("display: Model 4 (brand-only) methods keep per-credential rows", () => {
  const d = resolveSignInPasswordDisplay({
    perEmailManaged: false,
    methodsLoaded: true,
    methods: [
      { kind: "password", connectionKey: "dewalt" },
      { kind: "password", connectionKey: "stanley" },
    ],
  })
  assert.equal(d, "credentials")
})

test("display: EU shared-password methods keep per-credential rows", () => {
  const d = resolveSignInPasswordDisplay({
    perEmailManaged: false,
    methodsLoaded: true,
    methods: [{ kind: "password", connectionKey: "shared" }],
  })
  assert.equal(d, "credentials")
})

test("display: pending until methods load when the flag is not forwarded", () => {
  const d = resolveSignInPasswordDisplay({
    perEmailManaged: false,
    methodsLoaded: false,
    methods: [],
  })
  assert.equal(d, "pending")
})
