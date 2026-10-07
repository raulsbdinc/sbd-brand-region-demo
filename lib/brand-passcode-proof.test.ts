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
  // Brand storefronts (FR/DE/UK) delegate to the core; the send is the
  // passwordless email connection, never startDatabaseChallenge.
  const core = readFileSync(new URL("./passcode-start-core.ts", import.meta.url), "utf8")
  const brandBranch = start.slice(start.indexOf("export async function POST"), start.indexOf("async function legacyPasscodeStart"))
  assert.match(brandBranch, /brandAccessEnforced\(SITE_MARKET\) && brandPasscodeUsesMailboxProof\(SITE_MARKET\)/)
  assert.match(brandBranch, /runBrandPasscodeStart\(/)
  assert.match(brandBranch, /send: \(email, opts\) => startEmailPasscode\(creds!, email, opts\)/)
  assert.doesNotMatch(brandBranch, /startDatabaseChallenge/)
  assert.match(core, /handoff: \{ flow: "brand-proof", email, iat, brand: input\.siteBrand, preExistingPasswordlessSubs \}/)
  // Resend within a valid same-email/brand handoff keeps the ORIGINAL snapshot + iat.
  assert.match(brandBranch, /carryForwardProofSnapshot\(\{[\s\S]*flow: "brand-proof"[\s\S]*brand: SITE_BRAND/)
  assert.match(core, /const iat = carried\?\.iat \?\? startedAt/)
  assert.ok(core.indexOf("deps.snapshot(") < core.indexOf("deps.send("))
})

test("start: passwordless snapshot is taken BEFORE the challenge is sent", () => {
  const iSnap = start.indexOf("snapshotPasswordlessSubsFor(email)")
  const iSend = start.indexOf("await startEmailPasscode(")
  assert.ok(iSnap > 0 && iSend > iSnap)
})

test("verify: brand-proof branch delegates to the non-destructive bridge, never purges", () => {
  const branch = verify.slice(verify.indexOf('handoff.flow === "brand-proof"'))
  assert.match(branch, /completeBrandPasscodeVerify\(/)
  assert.match(branch, /siteBrand: SITE_BRAND/)
  assert.doesNotMatch(verify, /purgeTransientEmailStub|deleteUser\(/)
  assert.doesNotMatch(branch.slice(0, branch.indexOf("applySessionCookie(")), /claims\.sub/)
})
