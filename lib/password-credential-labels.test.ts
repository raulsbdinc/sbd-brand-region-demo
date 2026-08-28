import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ADD_PASSWORD_COMPLETE_MESSAGE,
  addPasswordDisplayState,
  brandDisplay,
  passwordCredentialLabel,
  passwordCredentialLine,
  rowBrandName,
  type PasswordCredentialView,
} from "./password-credential-labels.ts"

test("brandDisplay maps known brands and falls back safely", () => {
  assert.equal(brandDisplay("dewalt"), "DeWalt")
  assert.equal(brandDisplay("stanley"), "Stanley")
  assert.equal(brandDisplay(undefined), "this brand")
  assert.equal(brandDisplay("acme"), "this brand")
})

test("rowBrandName derives from the row's OWN brand/connectionKey", () => {
  assert.equal(rowBrandName({ connectionKey: "dewalt" }), "DeWalt")
  assert.equal(rowBrandName({ connectionKey: "stanley" }), "Stanley")
  // brand wins over connectionKey when both present
  assert.equal(rowBrandName({ connectionKey: "dewalt", brand: "stanley" }), "Stanley")
})

test("shared and per-email labels/lines never mention a brand", () => {
  const shared: PasswordCredentialView = { connectionKey: "shared" }
  assert.equal(passwordCredentialLabel(shared), "Account password")
  assert.match(passwordCredentialLine(shared), /verified account emails/)

  const perEmail: PasswordCredentialView = { connectionKey: "per-email", email: "alt@x.com" }
  assert.equal(passwordCredentialLabel(perEmail), "Password for alt@x.com")
  assert.match(passwordCredentialLine(perEmail), /^alt@x\.com has its own password/)
})

// The core correction-2 regression: on any deployment, an account holding BOTH
// a DeWalt and a Stanley credential must show each row named for its OWN brand.
test("DeWalt + Stanley rows are labelled independently (no deployment-brand bleed)", () => {
  const dewalt: PasswordCredentialView = { connectionKey: "dewalt", brand: "dewalt" }
  const stanley: PasswordCredentialView = { connectionKey: "stanley", brand: "stanley" }

  assert.equal(passwordCredentialLabel(dewalt), "DeWalt password")
  assert.equal(passwordCredentialLabel(stanley), "Stanley password")

  assert.match(passwordCredentialLine(dewalt), /Works only on DeWalt sites/)
  assert.match(passwordCredentialLine(stanley), /Works only on Stanley sites/)

  // The two labels must differ — the exact bug was both saying "DeWalt".
  assert.notEqual(passwordCredentialLabel(dewalt), passwordCredentialLabel(stanley))
})

// Even if brand is omitted, the connectionKey alone still yields the right brand.
test("brand label falls back to connectionKey when brand is absent", () => {
  assert.equal(passwordCredentialLabel({ connectionKey: "stanley" }), "Stanley password")
  assert.equal(passwordCredentialLabel({ connectionKey: "dewalt" }), "DeWalt password")
})

// --- addPasswordDisplayState: add vs completed, always-concrete brand --------

test("both outcomes unavailable → completed state (no add trigger)", () => {
  const s = addPasswordDisplayState({
    anotherEmail: { available: false },
    thisBrand: { available: false },
    deploymentBrand: "dewalt",
  })
  assert.equal(s.kind, "complete")
  if (s.kind === "complete") assert.equal(s.message, ADD_PASSWORD_COMPLETE_MESSAGE)
})

test("either outcome available → add state", () => {
  const onlyEmail = addPasswordDisplayState({
    anotherEmail: { available: true },
    thisBrand: { available: false },
    deploymentBrand: "dewalt",
  })
  assert.equal(onlyEmail.kind, "add")

  const onlyBrand = addPasswordDisplayState({
    anotherEmail: { available: false },
    thisBrand: { available: true },
    deploymentBrand: "stanley",
  })
  assert.equal(onlyBrand.kind, "add")
})

// The deployment brand must render CONCRETELY (DeWalt/Stanley) even when the
// this-brand option is unavailable because that credential already exists —
// never the vague "this brand" phrase.
test("add state names the deployment brand concretely, incl. when this-brand is taken", () => {
  const dewalt = addPasswordDisplayState({
    anotherEmail: { available: true },
    thisBrand: { available: false }, // e.g. already set up
    deploymentBrand: "dewalt",
  })
  assert.equal(dewalt.kind, "add")
  if (dewalt.kind === "add") {
    assert.equal(dewalt.deploymentBrandName, "DeWalt")
    assert.notEqual(dewalt.deploymentBrandName, "this brand")
  }

  const stanley = addPasswordDisplayState({
    anotherEmail: { available: true },
    thisBrand: { available: false },
    deploymentBrand: "stanley",
  })
  assert.equal(stanley.kind, "add")
  if (stanley.kind === "add") assert.equal(stanley.deploymentBrandName, "Stanley")
})
