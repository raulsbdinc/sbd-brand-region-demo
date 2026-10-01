import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  completeBrandPasscodeVerify,
  planBrandPasscodeVerify,
  snapshotPasswordlessSubs,
  type BrandPasscodeVerifyDeps,
  type PasswordlessStub,
} from "./brand-passcode-verify.ts"
import { encodeHandoffWithKey, HANDOFF_TTL_SECONDS } from "./passcode-handoff-codec.ts"
import {
  selectBrandPasscodeAccount,
  type BrandPasscodeCandidate,
} from "./brand-passcode-proof.ts"

const KEY = "test-secret"
const EMAIL = "sbdciam-eu-model4@mailinator.com"
const CANON = "auth0|canonical"
const NOW = 1_800_000_000_000

function handoff(over: Record<string, unknown> = {}, key = KEY): string {
  return encodeHandoffWithKey(
    {
      flow: "brand-proof",
      email: EMAIL,
      iat: NOW,
      brand: "dewalt",
      preExistingPasswordlessSubs: [],
      ...over,
    } as never,
    key,
  )
}

/**
 * Fake Management + IdP. Holds the full tenant surface — including deleteUser
 * and a generic "transfer" — so tests can prove the bridge never reaches them.
 */
function fakeTenant(opts: {
  otpSub?: string
  canonical?: string | null
  stubs?: Record<string, PasswordlessStub>
  linkThrows?: boolean
}) {
  const calls = { verify: 0, link: [] as [string, string][], mint: [] as string[], deleteUser: [] as string[] }
  const consumed = new Set<string>()
  const mgmt = {
    deleteUser: (id: string) => {
      calls.deleteUser.push(id)
    },
  }
  const deps: BrandPasscodeVerifyDeps = {
    async verifyOtp(email, code) {
      calls.verify++
      const k = `${email}:${code}`
      if (code !== "123456" || consumed.has(k)) throw new Error("bad otp")
      consumed.add(k) // single-use at the IdP
      return { sub: opts.otpSub ?? CANON }
    },
    async resolveCanonical() {
      return opts.canonical === undefined ? CANON : opts.canonical
    },
    async readStub(sub) {
      return opts.stubs?.[sub] ?? null
    },
    async linkStub(canonical, stubUserId) {
      if (opts.linkThrows) throw new Error("link 409")
      calls.link.push([canonical, stubUserId])
    },
    async mintSession(canonical) {
      calls.mint.push(canonical)
      return `cookie-for:${canonical}`
    },
  }
  return { deps, calls, mgmt }
}

const freshStub = (id: string, email = EMAIL): PasswordlessStub => ({
  userId: `email|${id}`,
  rootEmail: email,
  identities: [{ provider: "email", userId: id }],
})

const run = (raw: string | undefined, deps: BrandPasscodeVerifyDeps, over: { code?: string; siteBrand?: string; now?: number } = {}) =>
  completeBrandPasscodeVerify(
    { rawHandoff: raw, key: KEY, code: over.code ?? "123456", siteBrand: over.siteBrand ?? "dewalt", now: over.now ?? NOW },
    deps,
  )

test("tampered handoff: rejected before the code is consumed, nothing touched", async () => {
  const t = fakeTenant({})
  const raw = handoff()
  const [body, mac] = raw.split(".")
  const forged = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), email: "victim@x.com" }),
  ).toString("base64url")
  assert.deepEqual(await run(`${forged}.${mac}`, t.deps), { ok: false, reason: "bad-handoff" })
  assert.equal(t.calls.verify, 0)
  assert.equal(t.calls.mint.length, 0)
})

test("expired handoff: rejected, code not consumed", async () => {
  const t = fakeTenant({})
  const r = await run(handoff(), t.deps, { now: NOW + HANDOFF_TTL_SECONDS * 1000 + 1 })
  assert.deepEqual(r, { ok: false, reason: "bad-handoff" })
  assert.equal(t.calls.verify, 0)
})

test("handoff signed with another key: rejected", async () => {
  const t = fakeTenant({})
  assert.deepEqual(await run(handoff({}, "other"), t.deps), { ok: false, reason: "bad-handoff" })
})

test("non brand-proof handoff cannot enter this bridge", async () => {
  const t = fakeTenant({})
  assert.deepEqual(await run(handoff({ flow: "passwordless" }), t.deps), { ok: false, reason: "bad-handoff" })
})

test("wrong-brand replay: Stanley handoff on DeWalt is refused BEFORE the code is burned", async () => {
  const t = fakeTenant({})
  const r = await run(handoff({ brand: "stanley" }), t.deps, { siteBrand: "dewalt" })
  assert.deepEqual(r, { ok: false, reason: "wrong-brand" })
  assert.equal(t.calls.verify, 0)
  assert.equal(t.calls.link.length + t.calls.mint.length + t.calls.deleteUser.length, 0)
})

test("handoff without a brand is refused", async () => {
  const t = fakeTenant({})
  assert.equal((await run(handoff({ brand: undefined }), t.deps)).ok, false)
})

test("wrong code: no session", async () => {
  const t = fakeTenant({})
  assert.deepEqual(await run(handoff(), t.deps, { code: "000000" }), { ok: false, reason: "bad-code" })
  assert.equal(t.calls.mint.length, 0)
})

test("replayed code + handoff: second use rejected by the single-use IdP, link happens once", async () => {
  const t = fakeTenant({ otpSub: "email|new1", stubs: { "email|new1": freshStub("new1") } })
  const raw = handoff()
  assert.equal((await run(raw, t.deps)).ok, true)
  assert.deepEqual(await run(raw, t.deps), { ok: false, reason: "bad-code" })
  assert.equal(t.calls.link.length, 1)
  assert.equal(t.calls.mint.length, 1)
})

test("email identity already linked to the SAME canonical: session, no link, no delete", async () => {
  const t = fakeTenant({ otpSub: CANON })
  const r = await run(handoff(), t.deps)
  assert.deepEqual(r, { ok: true, canonical: CANON, cookieValue: `cookie-for:${CANON}`, linkedNewStub: false })
  assert.equal(t.calls.link.length, 0)
  assert.equal(t.calls.deleteUser.length, 0)
})

test("PRE-EXISTING standalone email-only customer: fail closed, record preserved, no session", async () => {
  const t = fakeTenant({ otpSub: "email|old", stubs: { "email|old": freshStub("old") } })
  const r = await run(handoff({ preExistingPasswordlessSubs: ["email|old"] }), t.deps)
  assert.deepEqual(r, { ok: false, reason: "pre-existing-passwordless" })
  assert.equal(t.calls.deleteUser.length, 0, "pre-existing email-only record must never be deleted")
  assert.equal(t.calls.link.length, 0, "pre-existing record must never be transferred")
  assert.equal(t.calls.mint.length, 0)
})

test("address owned by ANOTHER primary: fail closed, no session, no transfer", async () => {
  const t = fakeTenant({ otpSub: "auth0|someone-else" })
  const r = await run(handoff(), t.deps)
  assert.deepEqual(r, { ok: false, reason: "owned-elsewhere" })
  assert.equal(t.calls.link.length + t.calls.mint.length + t.calls.deleteUser.length, 0)
})

test("snapshot unavailable: a stub cannot be proven new, fail closed", async () => {
  const t = fakeTenant({ otpSub: "email|x", stubs: { "email|x": freshStub("x") } })
  const r = await run(handoff({ preExistingPasswordlessSubs: null }), t.deps)
  assert.deepEqual(r, { ok: false, reason: "snapshot-unavailable" })
  assert.equal(t.calls.link.length + t.calls.deleteUser.length, 0)
})

test("provably NEW unowned stub: linked to the canonical, canonical session opened, nothing deleted", async () => {
  const t = fakeTenant({ otpSub: "email|new1", stubs: { "email|new1": freshStub("new1") } })
  const r = await run(handoff({ preExistingPasswordlessSubs: ["email|unrelated"] }), t.deps)
  assert.deepEqual(r, { ok: true, canonical: CANON, cookieValue: `cookie-for:${CANON}`, linkedNewStub: true })
  assert.deepEqual(t.calls.link, [[CANON, "new1"]])
  assert.deepEqual(t.calls.mint, [CANON])
  assert.equal(t.calls.deleteUser.length, 0)
})

test("new sub whose account carries extra identities or another email is NOT provably new", async () => {
  for (const stub of [
    { ...freshStub("n"), identities: [{ provider: "email", userId: "n" }, { provider: "auth0", userId: "p" }] },
    freshStub("n", "other@x.com"),
  ]) {
    const t = fakeTenant({ otpSub: "email|n", stubs: { "email|n": stub } })
    assert.deepEqual(await run(handoff(), t.deps), { ok: false, reason: "not-provably-new" })
    assert.equal(t.calls.link.length + t.calls.deleteUser.length + t.calls.mint.length, 0)
  }
})

test("unreadable stub: fail closed", async () => {
  const t = fakeTenant({ otpSub: "email|n" })
  assert.deepEqual(await run(handoff(), t.deps), { ok: false, reason: "not-provably-new" })
})

test("link failure: stub RETAINED (no delete) and no session", async () => {
  const t = fakeTenant({ otpSub: "email|new1", stubs: { "email|new1": freshStub("new1") }, linkThrows: true })
  assert.deepEqual(await run(handoff(), t.deps), { ok: false, reason: "link-failed" })
  assert.equal(t.calls.deleteUser.length, 0)
  assert.equal(t.calls.mint.length, 0)
})

test("no unique brand canonical: no link, no session", async () => {
  const t = fakeTenant({ otpSub: "email|new1", canonical: null, stubs: { "email|new1": freshStub("new1") } })
  assert.deepEqual(await run(handoff(), t.deps), { ok: false, reason: "no-canonical" })
  assert.equal(t.calls.link.length + t.calls.mint.length, 0)
})

// --- both enrollment orders, real brand selector -------------------------

function enrolled(order: ("dewalt" | "stanley")[]): BrandPasscodeCandidate {
  return {
    accountId: CANON,
    bindings: order.map((k) => ({ connectionKey: k, email: EMAIL, auth0UserId: `${k}-id` })),
    identities: order.map((k) => ({ connectionKey: k, userId: `${k}-id` })),
  }
}

for (const order of [["dewalt", "stanley"], ["stanley", "dewalt"]] as const) {
  for (const brand of ["dewalt", "stanley"] as const) {
    test(`enrolled ${order.join("→")}: ${brand} passcode opens the SAME canonical`, async () => {
      const t = fakeTenant({ otpSub: "email|n", stubs: { "email|n": freshStub("n") } })
      t.deps.resolveCanonical = async (email) =>
        selectBrandPasscodeAccount({ email, brandKey: brand, candidates: [enrolled([...order])] })
      const r = await run(handoff({ brand }), t.deps, { siteBrand: brand })
      assert.equal(r.ok, true)
      assert.equal(r.ok && r.canonical, CANON)
      assert.equal(t.calls.deleteUser.length, 0)
    })
  }
}

test("enrolled in DeWalt only: Stanley passcode finds no canonical and fails closed", async () => {
  const t = fakeTenant({ otpSub: "email|n", stubs: { "email|n": freshStub("n") } })
  t.deps.resolveCanonical = async (email) =>
    selectBrandPasscodeAccount({ email, brandKey: "stanley", candidates: [enrolled(["dewalt"])] })
  assert.deepEqual(await run(handoff({ brand: "stanley" }), t.deps, { siteBrand: "stanley" }), {
    ok: false,
    reason: "no-canonical",
  })
  assert.equal(t.calls.link.length, 0)
})

// --- snapshot + planner -------------------------------------------------

test("snapshot records standalone email|… accounts and linked email identities", () => {
  assert.deepEqual(
    snapshotPasswordlessSubs([
      { userId: "email|a", identities: [{ provider: "email", userId: "a" }] },
      { userId: "auth0|p", identities: [{ provider: "auth0", userId: "p" }, { provider: "email", userId: "b" }] },
      { userId: "auth0|q", identities: [{ provider: "auth0", userId: "q" }] },
    ]),
    ["email|a", "email|b"],
  )
})

test("planner never yields a delete/transfer action for any input", () => {
  const kinds = new Set<string>()
  for (const verifiedSub of [CANON, "auth0|x", "email|old", "email|new"]) {
    for (const pre of [null, [], ["email|old"]]) {
      kinds.add(
        planBrandPasscodeVerify({
          email: EMAIL,
          canonical: CANON,
          verifiedSub,
          preExistingPasswordlessSubs: pre,
          stub: freshStub(verifiedSub.replace("email|", "")),
        }).kind,
      )
    }
  }
  assert.deepEqual([...kinds].sort(), ["fail", "link-new-stub", "session"])
})

test("structural guard: the brand passcode path has no delete/purge call", () => {
  for (const file of ["lib/brand-passcode-verify.ts", "app/api/signin/passcode/verify/route.ts", "app/api/signin/passcode/start/route.ts"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(src, /purgeTransientEmailStub|deleteUser\(|unlinkIdentity/, file)
  }
})
