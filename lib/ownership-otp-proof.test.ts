import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"

import {
  BRAND_ENROLL_PROOF_FLOW,
  carryForwardProofSnapshot,
  proveEnrollmentOwnershipOtp,
  type EnrollmentOtpProofDeps,
} from "./ownership-otp-proof.ts"
import { HANDOFF_TTL_SECONDS } from "./passcode-handoff-codec.ts"
import * as codec from "./passcode-handoff-codec.ts"

const HANDOFF_TTL_MS = HANDOFF_TTL_SECONDS * 1000

const KEY = "test-key-ownership-otp-proof-0123456789"
const EMAIL = "sbdciam-eu-case4@example.test"
const PRIMARY = "auth0|primary-canonical"
const FOREIGN = "auth0|someone-else"

function mint(payload: Record<string, unknown>, key = KEY): string {
  const enc = (codec as unknown as {
    encodeHandoffWithKey?: (p: unknown, k: string) => string
  }).encodeHandoffWithKey
  if (enc) return enc(payload, key)
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`
}

function handoff(over: Record<string, unknown> = {}) {
  return mint({
    flow: BRAND_ENROLL_PROOF_FLOW,
    email: EMAIL,
    iat: Date.now(),
    brand: "stanley",
    primaryUserId: PRIMARY,
    preExistingPasswordlessSubs: [],
    ...over,
  })
}

interface Spy {
  verify: number
  linked: Array<[string, string]>
  deleted: string[]
  unlinked: string[]
  sessions: number
}

/** Fake IO. deleteUser/unlink/session exist ONLY as spies the proof must never reach. */
function deps(opts: {
  sub?: string
  badCode?: boolean
  primary?: string | null
  stub?: { userId: string; rootEmail: string; providers: string[] } | null
  linkFails?: boolean
  consumed?: Set<string>
} = {}): { d: EnrollmentOtpProofDeps & Record<string, unknown>; spy: Spy } {
  const spy: Spy = { verify: 0, linked: [], deleted: [], unlinked: [], sessions: 0 }
  const consumed = opts.consumed ?? new Set<string>()
  const d = {
    async verifyOtp(_e: string, code: string) {
      spy.verify++
      if (opts.badCode || consumed.has(code)) throw new Error("invalid_grant")
      consumed.add(code)
      return { sub: opts.sub ?? PRIMARY }
    },
    async resolvePrimary() {
      return opts.primary === undefined ? PRIMARY : opts.primary
    },
    async readStub(sub: string) {
      const s = opts.stub
      if (!s || s.userId !== sub) return null
      return {
        userId: s.userId,
        rootEmail: s.rootEmail,
        identities: s.providers.map((provider) => ({ provider, userId: s.userId.split("|")[1] })),
      }
    },
    async linkStub(primary: string, stub: string) {
      if (opts.linkFails) throw new Error("link failed")
      spy.linked.push([primary, stub])
    },
    deleteUser(id: string) {
      spy.deleted.push(id)
    },
    unlinkIdentity(id: string) {
      spy.unlinked.push(id)
    },
    createSession() {
      spy.sessions++
    },
  }
  return { d, spy }
}

const run = (
  d: EnrollmentOtpProofDeps,
  over: { raw?: string; code?: string; siteBrand?: string; primary?: string; email?: string } = {},
) =>
  proveEnrollmentOwnershipOtp(
    {
      rawHandoff: over.raw ?? handoff(),
      key: KEY,
      code: over.code ?? "123456",
      siteBrand: over.siteBrand ?? "stanley",
      expected: { email: over.email ?? EMAIL, primaryUserId: over.primary ?? PRIMARY },
    },
    d,
  )

function assertNoMutation(spy: Spy) {
  assert.deepEqual(spy.deleted, [], "delete must never be called")
  assert.deepEqual(spy.unlinked, [], "unlink must never be called")
  assert.equal(spy.sessions, 0, "the proof never opens a session")
}

test("already linked to SAME primary → ok, no link, no mutation", async () => {
  const { d, spy } = deps({ sub: PRIMARY })
  const r = await run(d)
  assert.deepEqual(r, { ok: true, primaryUserId: PRIMARY, linkedNewStub: false, codeConsumed: true })
  assert.deepEqual(spy.linked, [])
  assertNoMutation(spy)
})

test("pre-existing standalone EMAIL-only customer → fail closed, untouched", async () => {
  const stub = { userId: "email|existing", rootEmail: EMAIL, providers: ["email"] }
  const { d, spy } = deps({ sub: stub.userId, stub })
  const r = await run(d, { raw: handoff({ preExistingPasswordlessSubs: [stub.userId] }) })
  assert.equal(r.ok, false)
  assert.deepEqual(spy.linked, [])
  assertNoMutation(spy)
})

test("pre-existing SMS customer (non-email sub) → fail closed, untouched", async () => {
  const { d, spy } = deps({ sub: "sms|+447700900000" })
  const r = await run(d)
  assert.equal(r.ok, false)
  assert.deepEqual(spy.linked, [])
  assertNoMutation(spy)
})

test("foreign-owned identity (verified sub is another DB account) → fail closed", async () => {
  const { d, spy } = deps({ sub: FOREIGN })
  const r = await run(d)
  assert.equal(r.ok, false)
  assert.deepEqual(spy.linked, [])
  assertNoMutation(spy)
})

test("unknown snapshot (null) → never treated as fresh", async () => {
  const stub = { userId: "email|maybe", rootEmail: EMAIL, providers: ["email"] }
  const { d, spy } = deps({ sub: stub.userId, stub })
  const r = await run(d, { raw: handoff({ preExistingPasswordlessSubs: null }) })
  assert.equal(r.ok, false)
  assertNoMutation(spy)
  assert.deepEqual(spy.linked, [])
})

test("fresh unowned challenge stub → linked to SAME primary only", async () => {
  const stub = { userId: "email|fresh", rootEmail: EMAIL, providers: ["email"] }
  const { d, spy } = deps({ sub: stub.userId, stub })
  const r = await run(d)
  assert.deepEqual(r, { ok: true, primaryUserId: PRIMARY, linkedNewStub: true, codeConsumed: true })
  assert.deepEqual(spy.linked, [[PRIMARY, "fresh"]])
  assertNoMutation(spy)
})

test("fresh stub already carrying a non-passwordless identity → fail closed", async () => {
  const stub = { userId: "email|fresh", rootEmail: EMAIL, providers: ["email", "auth0"] }
  const { d, spy } = deps({ sub: stub.userId, stub })
  const r = await run(d)
  assert.equal(r.ok, false)
  assertNoMutation(spy)
  assert.deepEqual(spy.linked, [])
})

test("failed link → stub RETAINED, fail closed, no delete", async () => {
  const stub = { userId: "email|fresh", rootEmail: EMAIL, providers: ["email"] }
  const { d, spy } = deps({ sub: stub.userId, stub, linkFails: true })
  const r = await run(d)
  assert.deepEqual(r, { ok: false, reason: "link-failed", codeConsumed: true })
  assertNoMutation(spy)
})

test("ambiguous / disappeared primary at verify → fail closed, no link", async () => {
  for (const primary of [null, FOREIGN]) {
    const stub = { userId: "email|fresh", rootEmail: EMAIL, providers: ["email"] }
    const { d, spy } = deps({ sub: stub.userId, stub, primary })
    const r = await run(d)
    assert.deepEqual(r, { ok: false, reason: "primary-changed", codeConsumed: true })
    assert.deepEqual(spy.linked, [])
    assertNoMutation(spy)
  }
})

test("wrong code → bad-code, nothing read or mutated; correct code later still works", async () => {
  const bad = deps({ badCode: true })
  assert.deepEqual(await run(bad.d), { ok: false, reason: "bad-code", codeConsumed: false })
  assertNoMutation(bad.spy)
  const good = deps({ sub: PRIMARY })
  assert.equal((await run(good.d)).ok, true)
})

test("consumed code replay → bad-code (IdP single-use), no mutation", async () => {
  const consumed = new Set<string>()
  const first = deps({ sub: PRIMARY, consumed })
  assert.equal((await run(first.d, { code: "999999" })).ok, true)
  const replay = deps({ sub: PRIMARY, consumed })
  assert.deepEqual(await run(replay.d, { code: "999999" }), {
    ok: false,
    reason: "bad-code",
    codeConsumed: false,
  })
  assertNoMutation(replay.spy)
})

test("expired / tampered / wrong-purpose / wrong-key handoff → code never consumed", async () => {
  const old = Date.now() - HANDOFF_TTL_MS - 1000
  const tampered = handoff().slice(0, -2) + "xx"
  const cases = [
    handoff({ iat: old }),
    tampered,
    handoff({ flow: "brand-proof" }),
    mint({ flow: BRAND_ENROLL_PROOF_FLOW, email: EMAIL, iat: Date.now(), brand: "stanley", primaryUserId: PRIMARY, preExistingPasswordlessSubs: [] }, "other-key-xxxxxxxxxxxxxxxxxxxxxxxxx"),
    undefined as unknown as string,
  ]
  for (const raw of cases) {
    const { d, spy } = deps()
    const r = await proveEnrollmentOwnershipOtp(
      { rawHandoff: raw, key: KEY, code: "1", siteBrand: "stanley", expected: { email: EMAIL, primaryUserId: PRIMARY } },
      d,
    )
    assert.deepEqual(r, { ok: false, reason: "bad-handoff", codeConsumed: false })
    assert.equal(spy.verify, 0)
    assertNoMutation(spy)
  }
})

test("wrong-brand / cross-site reuse → code never consumed", async () => {
  const { d, spy } = deps()
  assert.deepEqual(await run(d, { siteBrand: "dewalt" }), {
    ok: false,
    reason: "wrong-brand",
    codeConsumed: false,
  })
  assert.equal(spy.verify, 0)
  assertNoMutation(spy)
})

test("handoff bound to another primary or email → code never consumed", async () => {
  for (const over of [{ primary: FOREIGN }, { email: "other@example.test" }]) {
    const { d, spy } = deps()
    assert.equal((await run(d, over)).ok, false)
    assert.equal(spy.verify, 0)
    assertNoMutation(spy)
  }
})

test("both enrollment orders: proof is brand-scoped and binds the ORIGINAL primary", async () => {
  for (const [first, second] of [["dewalt", "stanley"], ["stanley", "dewalt"]]) {
    const { d, spy } = deps({ sub: PRIMARY })
    const raw = handoff({ brand: second })
    assert.equal((await run(d, { raw, siteBrand: first })).ok, false, `${second} proof refused on ${first}`)
    const r = await run(d, { raw, siteBrand: second })
    assert.equal(r.ok && r.primaryUserId, PRIMARY, "canonical stays the original primary")
    assertNoMutation(spy)
  }
})

// ---------------------------------------------------------------------------
// Resend provenance
// ---------------------------------------------------------------------------

test("resend carries the ORIGINAL snapshot + iat, so the first send's own stub stays fresh", () => {
  const iat = Date.now() - 60_000
  const prior = handoff({ iat, preExistingPasswordlessSubs: ["email|old-customer"] })
  const carried = carryForwardProofSnapshot({
    priorRaw: prior,
    key: KEY,
    flow: BRAND_ENROLL_PROOF_FLOW,
    email: EMAIL.toUpperCase(),
    brand: "stanley",
    primaryUserId: PRIMARY,
  })
  assert.deepEqual(carried, { iat, preExistingPasswordlessSubs: ["email|old-customer"] })
})

test("resend then verify: stub minted by FIRST send links; pre-existing stays pre-existing", async () => {
  const prior = handoff({ preExistingPasswordlessSubs: ["email|old-customer"] })
  const carried = carryForwardProofSnapshot({
    priorRaw: prior, key: KEY, flow: BRAND_ENROLL_PROOF_FLOW, email: EMAIL, brand: "stanley", primaryUserId: PRIMARY,
  })!
  const resent = handoff(carried)

  const stub = { userId: "email|minted-at-first-send", rootEmail: EMAIL, providers: ["email"] }
  const a = deps({ sub: stub.userId, stub })
  assert.equal((await run(a.d, { raw: resent })).ok, true)
  assert.deepEqual(a.spy.linked, [[PRIMARY, "minted-at-first-send"]])

  const old = { userId: "email|old-customer", rootEmail: EMAIL, providers: ["email"] }
  const b = deps({ sub: old.userId, stub: old })
  assert.equal((await run(b.d, { raw: resent })).ok, false)
  assertNoMutation(b.spy)
  assert.deepEqual(b.spy.linked, [])
})

test("no carry-forward across email, brand, primary, flow, expiry or forged cookie", () => {
  const base = { key: KEY, flow: BRAND_ENROLL_PROOF_FLOW, email: EMAIL, brand: "stanley", primaryUserId: PRIMARY }
  const ok = handoff()
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: ok, email: "x@example.test" }), null)
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: ok, brand: "dewalt" }), null)
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: ok, primaryUserId: FOREIGN }), null)
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: ok, flow: "brand-proof" }), null)
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: handoff({ iat: Date.now() - HANDOFF_TTL_MS - 1 }) }), null)
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: ok.slice(0, -2) + "xx" }), null)
  assert.equal(carryForwardProofSnapshot({ ...base, priorRaw: handoff({ preExistingPasswordlessSubs: null }) }), null)
})

// ---------------------------------------------------------------------------
// Static guarantees over the real route/bridge sources
// ---------------------------------------------------------------------------

test("no ownership/proof flow can delete or unlink; purge helper is gone", () => {
  const files = [
    "lib/ownership-otp-proof.ts",
    "lib/credential-resolver.ts",
    "lib/add-email-ownership.ts",
    "app/api/registration/brand/proof/route.ts",
    "app/api/registration/brand/proof/start/route.ts",
    "app/api/registration/per-email/complete/route.ts",
    "app/api/account/emails/verify/route.ts",
    "app/api/signin/passcode/start/route.ts",
    "app/api/signin/passcode/verify/route.ts",
  ]
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8")
    assert.doesNotMatch(src, /purgeTransientEmailStub|selectTransientEmailStubIds|deleteUser\(|unlinkIdentity\(/, f)
  }
})

test("brand proof route uses the preserving proof, guarded before enrollment", () => {
  const src = readFileSync(new URL("../app/api/registration/brand/proof/route.ts", import.meta.url), "utf8")
  assert.match(src, /proveEnrollmentOwnershipOtp\(/)
  assert.ok(src.indexOf("proveEnrollmentOwnershipOtp(") < src.lastIndexOf("proofVerified = true"))
  const start = readFileSync(new URL("../app/api/registration/brand/proof/start/route.ts", import.meta.url), "utf8")
  assert.ok(
    start.indexOf("snapshotPasswordlessSubsFor(") < start.indexOf("startEmailPasscode("),
    "snapshot is taken BEFORE the challenge is sent",
  )
  assert.match(start, /carryForwardProofSnapshot\(/)
})
