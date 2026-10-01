import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { brandAccessEnforced, brandPasscodeUsesMailboxProof } from "./brand-access.ts"
import { completeBrandPasscodeVerify, type BrandPasscodeVerifyDeps } from "./brand-passcode-verify.ts"
import { encodeHandoffWithKey } from "./passcode-handoff-codec.ts"
import { brandVerifiedUser, isBrandVerified } from "./brand-session-gate.ts"

const KEY = "uk-test-secret"
const EMAIL = "sbdciam-uk-model4@mailinator.com"
const NOW = 1_800_000_000_000
const BRANDS = ["dewalt", "stanley"] as const

const handoff = (brand: string, over: Record<string, unknown> = {}) =>
  encodeHandoffWithKey(
    { flow: "brand-proof", email: EMAIL, iat: NOW, brand, preExistingPasswordlessSubs: [], ...over } as never,
    KEY,
  )

function ukTenant(enrolled: Partial<Record<string, string>>) {
  const calls = { verify: 0, resolvedFor: [] as string[], mint: [] as string[] }
  const consumed = new Set<string>()
  let site = ""
  const deps: BrandPasscodeVerifyDeps = {
    async verifyOtp(email, code) {
      calls.verify++
      const k = `${email}:${code}`
      if (code !== "123456" || consumed.has(k)) throw new Error("bad otp")
      consumed.add(k)
      return { sub: enrolled[site] ?? "email|stub" }
    },
    async resolveCanonical() {
      calls.resolvedFor.push(site)
      return enrolled[site] ?? null
    },
    async readStub() {
      return null
    },
    async linkStub() {
      throw new Error("must not link in these cases")
    },
    async mintSession(canonical) {
      calls.mint.push(canonical)
      return `cookie:${canonical}`
    },
  }
  const run = (siteBrand: string, raw: string, code = "123456") => {
    site = siteBrand
    return completeBrandPasscodeVerify({ rawHandoff: raw, key: KEY, code, siteBrand, now: NOW }, deps)
  }
  return { run, calls }
}

test("every brand-enforced market delivers the code via the mailbox proof bridge (regression: UK sent nothing)", () => {
  for (const m of ["fr", "de", "uk"]) {
    assert.equal(brandAccessEnforced(m), true, m)
    assert.equal(brandPasscodeUsesMailboxProof(m), true, m)
  }
  for (const m of ["us", "ca", "au"]) assert.equal(brandPasscodeUsesMailboxProof(m), false, m)
})

test("start route sends the passwordless email (not a native DB challenge) for brand proof", () => {
  const src = readFileSync(new URL("../app/api/signin/passcode/start/route.ts", import.meta.url), "utf8")
  assert.match(src, /brandPasscodeUsesMailboxProof\(SITE_MARKET\)/)
  assert.match(src, /if \(brandProof\) \{\s*await startEmailPasscode\(creds, email\)/)
})

for (const brand of BRANDS) {
  test(`UK ${brand}: enrolled customer — code consumed, canonical re-resolved, session minted for that canonical`, async () => {
    const canon = `auth0|uk-${brand}`
    const t = ukTenant({ [brand]: canon })
    const r = await t.run(brand, handoff(brand))
    assert.deepEqual(r, { ok: true, canonical: canon, cookieValue: `cookie:${canon}`, linkedNewStub: false })
    assert.equal(t.calls.verify, 1)
    assert.deepEqual(t.calls.resolvedFor, [brand])
    assert.deepEqual(t.calls.mint, [canon])
  })
}

test("UK unenrolled brand: valid mailbox code but no this-brand canonical — no session", async () => {
  const t = ukTenant({ dewalt: "auth0|uk-dewalt" })
  const r = await t.run("stanley", handoff("stanley"))
  assert.equal(r.ok, false)
  assert.equal(t.calls.mint.length, 0)
})

test("UK cross-brand replay: DeWalt handoff on Stanley UK refused before the code is burned", async () => {
  const t = ukTenant({ dewalt: "auth0|uk-dewalt", stanley: "auth0|uk-stanley" })
  const r = await t.run("stanley", handoff("dewalt"))
  assert.equal(r.ok, false)
  assert.equal(t.calls.verify, 0)
  assert.equal(t.calls.mint.length, 0)
})

test("UK replayed code: second use rejected at the IdP, single session only", async () => {
  const t = ukTenant({ dewalt: "auth0|uk-dewalt" })
  assert.equal((await t.run("dewalt", handoff("dewalt"))).ok, true)
  assert.equal((await t.run("dewalt", handoff("dewalt"))).ok, false)
  assert.equal(t.calls.mint.length, 1)
})

test("cross-region isolation: a UK brand stamp never satisfies FR/DE, and vice versa", () => {
  for (const brand of BRANDS) {
    const uk = brandVerifiedUser({ sub: "auth0|x" }, "uk", brand)
    assert.equal(isBrandVerified(uk, "uk", brand), true)
    assert.equal(isBrandVerified(uk, "fr", brand), false)
    assert.equal(isBrandVerified(uk, "de", brand), false)
    assert.equal(isBrandVerified(uk, "uk", brand === "dewalt" ? "stanley" : "dewalt"), false)
    const fr = brandVerifiedUser({ sub: "auth0|x" }, "fr", brand)
    assert.equal(isBrandVerified(fr, "uk", brand), false)
  }
})
