import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { selectBrandPasscodeAccount, type BrandPasscodeCandidate } from "./brand-passcode-proof.ts"

const EMAIL = "sbdciam-eu-final76-r1-fr@mailinator.com"

// Live shape: one canonical holding DeWalt (primary) + Stanley (linked) identities.
const both: BrandPasscodeCandidate = {
  accountId: "auth0|6abeaf7b",
  bindings: [
    { connectionKey: "dewalt", email: EMAIL, auth0UserId: "6abeaf7b" },
    { connectionKey: "stanley", email: EMAIL, auth0UserId: "6abeb0c1" },
  ],
  identities: [
    { connectionKey: "dewalt", userId: "6abeaf7b" },
    { connectionKey: "stanley", userId: "6abeb0c1" },
  ],
}

test("DeWalt storefront resolves the canonical (DeWalt first)", () => {
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [both] }), "auth0|6abeaf7b")
})

test("Stanley storefront resolves the SAME canonical via its linked identity", () => {
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL.toUpperCase(), brandKey: "stanley", candidates: [both] }), "auth0|6abeaf7b")
})

test("Stanley-first canonical resolves on DeWalt after DeWalt enrollment", () => {
  const stanleyFirst: BrandPasscodeCandidate = {
    accountId: "auth0|st01",
    bindings: [
      { connectionKey: "stanley", email: EMAIL, auth0UserId: "st01" },
      { connectionKey: "dewalt", email: EMAIL, auth0UserId: "dw02" },
    ],
    identities: [
      { connectionKey: "stanley", userId: "st01" },
      { connectionKey: "dewalt", userId: "dw02" },
    ],
  }
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [stanleyFirst] }), "auth0|st01")
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "stanley", candidates: [stanleyFirst] }), "auth0|st01")
})

test("DeWalt-only account is refused on Stanley", () => {
  const dwOnly: BrandPasscodeCandidate = {
    accountId: "auth0|dw",
    bindings: [{ connectionKey: "dewalt", email: EMAIL, auth0UserId: "dw" }],
    identities: [{ connectionKey: "dewalt", userId: "dw" }],
  }
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "stanley", candidates: [dwOnly] }), null)
})

test("binding without its identity is refused (metadata alone is not enrollment)", () => {
  const stray: BrandPasscodeCandidate = {
    accountId: "auth0|x",
    bindings: [{ connectionKey: "dewalt", email: EMAIL, auth0UserId: "gone" }],
    identities: [{ connectionKey: "dewalt", userId: "other" }],
  }
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [stray] }), null)
})

test("email match alone (legacy/shared or unbound) is refused", () => {
  const legacy: BrandPasscodeCandidate = {
    accountId: "auth0|legacy",
    bindings: [],
    identities: [{ connectionKey: "shared", userId: "legacy" }],
  }
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [legacy] }), null)
})

test("binding for a different email is refused", () => {
  const other: BrandPasscodeCandidate = {
    ...both,
    bindings: [{ connectionKey: "dewalt", email: "someone@else.test", auth0UserId: "6abeaf7b" }],
  }
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [other] }), null)
})

test("two distinct enrolled owners fail closed", () => {
  const twin = { ...both, accountId: "auth0|twin" }
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [both, twin] }), null)
})

test("the same owner returned by both lookups is not ambiguous", () => {
  assert.equal(selectBrandPasscodeAccount({ email: EMAIL, brandKey: "dewalt", candidates: [both, both] }), "auth0|6abeaf7b")
})

test("empty email fails closed", () => {
  assert.equal(selectBrandPasscodeAccount({ email: " ", brandKey: "dewalt", candidates: [both] }), null)
})

// WIRING PINS — the routes must use the proof path exactly as designed.
const start = readFileSync(new URL("../app/api/signin/passcode/start/route.ts", import.meta.url), "utf8")
const verify = readFileSync(new URL("../app/api/signin/passcode/verify/route.ts", import.meta.url), "utf8")

test("start: brand-resolved EU passcode is sent via the email connection, not /otp/challenge", () => {
  assert.match(start, /brandProof\s*=[\s\S]*brandScoped[\s\S]*resolution\.kind === "resolved"/)
  assert.match(start, /if \(brandProof\) \{\s*await startEmailPasscode\(creds, email\)/)
  assert.match(start, /flow: brandProof \? "brand-proof" : flow/)
})

test("verify: consumes code, purges stub, re-resolves canonical, mints canonical session", () => {
  const branch = verify.slice(verify.indexOf('handoff.flow === "brand-proof"'))
  const iVerify = branch.indexOf("verifyEmailPasscode(")
  const iPurge = branch.indexOf("purgeTransientEmailStub(")
  const iResolve = branch.indexOf("resolveBrandPasscodeAccount(")
  const iMint = branch.indexOf("mintPrimarySessionCookie(")
  assert.ok(iVerify > 0 && iPurge > iVerify && iResolve > iPurge && iMint > iResolve)
  assert.doesNotMatch(branch.slice(0, iMint), /claims\.sub/)
})
