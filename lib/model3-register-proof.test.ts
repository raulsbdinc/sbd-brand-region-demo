// END-TO-END PROOF test for signed-out Model-3 registration.
// ===========================================================
// This composes the SAME pieces the create route uses to decide whether to
// provision, and asserts that NOTHING is created/linked/bound until every email
// being registered has had a fresh one-time code CONSUMED at the IdP in this
// request. The trust boundary is two layers:
//
//   1. lib/handoff-token — decides whether the cookie is an authentic, unexpired
//      "model3-register" binding. A missing / expired / tampered / wrong-purpose
//      / wrong-secret cookie decodes to `null` bound emails.
//   2. lib/model-registration#registerModel3WithProof — the single create path.
//      It CONSUMES each code (verifyPasscode) immediately before any tenant
//      mutation, so a replayed/consumed code is rejected by the IdP itself, not
//      by any cookie state. Clearing the cookie is NOT the replay defence and is
//      deliberately not relied on here.
//
// Every assertion checks the Management-side call COUNTS (create/link/update) to
// prove the security property directly: bad proof ⇒ zero mutations.

import { test } from "node:test"
import assert from "node:assert/strict"
import { signHandoff, verifyHandoff } from "./handoff-token.ts"
import { type Model3RegisterBinding } from "./account-model.ts"
import {
  registerModel3WithProof,
  type ManagementDeps,
  type ProofDeps,
  type IdentityToCreate,
} from "./model-registration.ts"
import type { Auth0User } from "./auth0-management.ts"

const SECRET = "test-secret-key-do-not-use-in-prod"
const TTL = 10 * 60 * 1000
const PURPOSE = "model3-register" as const

// --- Fake tenant that COUNTS every mutation (no collisions configured) ------
function makeMgmt() {
  const calls = { create: 0, link: 0, update: 0, del: 0 }
  let seq = 0
  const deps: ManagementDeps = {
    async createUser({ connection, email }) {
      calls.create += 1
      const id = `auth0|n${++seq}`
      const user: Auth0User = {
        user_id: id,
        email,
        identities: [{ connection, provider: "auth0", user_id: id.split("|")[1] }],
        app_metadata: {},
      }
      return user
    },
    async deleteUser() {
      calls.del += 1
      return null
    },
    async getUser() {
      throw new Error("not found")
    },
    async getUsersByEmail() {
      return [] // never a collision in these tests
    },
    async linkIdentity() {
      calls.link += 1
      return [] as never
    },
    async unlinkIdentity() {
      return [] as never
    },
    async updateUser(userId) {
      calls.update += 1
      return { user_id: userId, email: "", identities: [], app_metadata: {} } as Auth0User
    },
  }
  return { deps, calls }
}

// --- Fake IdP one-time-code consumer: single-use per code -------------------
// `valid` maps a normalized email → its ONE correct code. A correct code works
// exactly once; the same code presented again throws (as Auth0's OTP grant does
// after it single-uses the code). We record every attempt so a "missing code"
// case can prove nothing was consumed.
function makeVerifier(valid: Record<string, string>) {
  const consumed = new Set<string>()
  const attempts: Array<{ email: string; otp: string }> = []
  const verifyPasscode: ProofDeps["verifyPasscode"] = async (email, otp) => {
    attempts.push({ email, otp })
    const key = `${email.toLowerCase()}:${otp}`
    if (consumed.has(key)) throw new Error("code already used")
    if (valid[email.toLowerCase()] !== otp) throw new Error("bad or expired code")
    consumed.add(key)
  }
  return { verifyPasscode, attempts }
}

function mint(data: Model3RegisterBinding, now?: number) {
  return signHandoff(PURPOSE, data, SECRET, now)
}

// Decode the cookie exactly like the route: authentic+unexpired ⇒ bound emails,
// otherwise null.
function boundFrom(cookie: string | undefined | null, now?: number) {
  const v = verifyHandoff<Model3RegisterBinding>(cookie, PURPOSE, SECRET, { maxAgeMs: TTL, now })
  return v.ok ? { primaryEmail: v.data.primaryEmail, secondaryEmail: v.data.secondaryEmail } : null
}

type PlainIdentity = Omit<IdentityToCreate, "emailVerified">

// --- Happy paths ------------------------------------------------------------

test("single email: correct code is consumed, then exactly one account is created", async () => {
  const { deps, calls } = makeMgmt()
  const v = makeVerifier({ "a@example.com": "111111" })
  const out = await registerModel3WithProof(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      boundEmails: boundFrom(mint({ primaryEmail: "a@example.com" })),
      identities: [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" }],
      codes: { "a@example.com": "111111" },
    },
    { ...deps, verifyPasscode: v.verifyPasscode },
  )
  assert.equal(out.ok, true)
  assert.equal(calls.create, 1)
  assert.equal(v.attempts.length, 1)
})

test("two emails: both codes consumed, two users created + linked + bound", async () => {
  const { deps, calls } = makeMgmt()
  const v = makeVerifier({ "a@example.com": "111111", "b@example.com": "222222" })
  const out = await registerModel3WithProof(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      boundEmails: boundFrom(mint({ primaryEmail: "a@example.com", secondaryEmail: "b@example.com" })),
      identities: [
        { email: "a@example.com", password: "Str0ngPass1", role: "primary" },
        { email: "b@example.com", password: "Str0ngPass2", role: "secondary" },
      ],
      codes: { "a@example.com": "111111", "b@example.com": "222222" },
    },
    { ...deps, verifyPasscode: v.verifyPasscode },
  )
  assert.equal(out.ok, true)
  assert.equal(calls.create, 2)
  assert.equal(calls.link, 1)
  assert.equal(calls.update, 1)
})

// --- Password policy gate: rejected BEFORE any code is consumed -------------
// Reproduces the live UK defect — a policy-violating password used to be
// rejected only by Auth0 AFTER we had already consumed the one-time code,
// minting an orphan passwordless stub. The pre-consumption gate must fail
// closed with 400 and ZERO consumption / ZERO mutation.

test("policy-violating password (email user-info token) → 400 and ZERO codes consumed", async () => {
  const { deps, calls } = makeMgmt()
  const email = "sbdciam-uk1-2309@example.com" // local part tokenises to include "uk1"
  const v = makeVerifier({ [email]: "111111" })
  const out = await registerModel3WithProof(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      boundEmails: boundFrom(mint({ primaryEmail: email })),
      identities: [{ email, password: "Ciam!2026UK1A", role: "primary" }], // contains "uk1"
      codes: { [email]: "111111" },
    },
    { ...deps, verifyPasscode: v.verifyPasscode },
  )
  assert.equal(out.ok, false)
  if (!out.ok) {
    assert.equal(out.status, 400)
    assert.deepEqual(out.failedEmails, [email])
  }
  assert.equal(v.attempts.length, 0) // the one-time code is NEVER consumed → no orphan stub
  assert.equal(calls.create, 0)
  assert.equal(calls.link, 0)
})

test("weak password (only 2 character classes) → 400 before any consumption", async () => {
  const { deps, calls } = makeMgmt()
  const v = makeVerifier({ "a@example.com": "111111" })
  const out = await registerModel3WithProof(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      boundEmails: boundFrom(mint({ primaryEmail: "a@example.com" })),
      identities: [{ email: "a@example.com", password: "supersecret1", role: "primary" }], // lower+digit only
      codes: { "a@example.com": "111111" },
    },
    { ...deps, verifyPasscode: v.verifyPasscode },
  )
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.status, 400)
  assert.equal(v.attempts.length, 0)
  assert.equal(calls.create, 0)
})

// --- No binding / bad binding: zero mutations, and (crucially) zero consume --

async function expectNoMutation(
  boundEmails: { primaryEmail: string; secondaryEmail?: string } | null,
  identities: PlainIdentity[],
  codes: Record<string, string | undefined>,
  valid: Record<string, string>,
) {
  const { deps, calls } = makeMgmt()
  const v = makeVerifier(valid)
  const out = await registerModel3WithProof(
    { connectionKey: "per-email", connectionName: "sbd-demo-per-email", boundEmails, identities, codes },
    { ...deps, verifyPasscode: v.verifyPasscode },
  )
  assert.equal(out.ok, false)
  assert.equal(calls.create, 0)
  assert.equal(calls.link, 0)
  assert.equal(calls.update, 0)
  return { out, attempts: v.attempts, calls }
}

test("no cookie → null binding → 403, no create and no code consumed", async () => {
  const { out, attempts } = await expectNoMutation(
    boundFrom(undefined),
    [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" }],
    { "a@example.com": "111111" },
    { "a@example.com": "111111" },
  )
  if (!out.ok) assert.equal(out.status, 403)
  assert.equal(attempts.length, 0)
})

test("tampered payload (add an email) → bad signature → null binding → no create", async () => {
  const cookie = mint({ primaryEmail: "a@example.com" })
  const dot = cookie.lastIndexOf(".")
  const envelope = JSON.parse(Buffer.from(cookie.slice(0, dot), "base64url").toString("utf8"))
  envelope.data.secondaryEmail = "evil@example.com"
  const forgedBody = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
  const forged = `${forgedBody}.${cookie.slice(dot + 1)}`

  const { attempts } = await expectNoMutation(
    boundFrom(forged),
    [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" }],
    { "a@example.com": "111111" },
    { "a@example.com": "111111" },
  )
  assert.equal(attempts.length, 0)
})

test("expired binding → null → no create and no code consumed", async () => {
  const mintedAt = 1_000_000
  const cookie = mint({ primaryEmail: "a@example.com" }, mintedAt)
  const { attempts } = await expectNoMutation(
    boundFrom(cookie, mintedAt + TTL + 1),
    [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" }],
    { "a@example.com": "111111" },
    { "a@example.com": "111111" },
  )
  assert.equal(attempts.length, 0)
})

test("binding minted for a DIFFERENT purpose → null → no create", async () => {
  const other = signHandoff("model3-complete", { primaryEmail: "a@example.com" }, SECRET)
  await expectNoMutation(
    boundFrom(other),
    [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" }],
    { "a@example.com": "111111" },
    { "a@example.com": "111111" },
  )
})

test("binding signed with the WRONG secret → null → no create", async () => {
  const bad = signHandoff(PURPOSE, { primaryEmail: "a@example.com" }, "attacker-secret")
  await expectNoMutation(
    boundFrom(bad),
    [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" }],
    { "a@example.com": "111111" },
    { "a@example.com": "111111" },
  )
})

// --- Wrong-email: provisioning a different address than the bound set --------

test("bound a@+b@ but identities a@+evil@ (swap) → mismatch, no create, no consume", async () => {
  const { out, attempts } = await expectNoMutation(
    boundFrom(mint({ primaryEmail: "a@example.com", secondaryEmail: "b@example.com" })),
    [
      { email: "a@example.com", password: "Str0ngPass1", role: "primary" },
      { email: "evil@example.com", password: "Str0ngPass2", role: "secondary" },
    ],
    { "a@example.com": "111111", "evil@example.com": "222222" },
    { "a@example.com": "111111", "b@example.com": "222222" },
  )
  if (!out.ok) assert.equal(out.status, 403)
  assert.equal(attempts.length, 0) // mismatch is caught BEFORE any consumption
})

// --- Missing code: presence checked for ALL before consuming ANY ------------

test("pair with the second code missing → 400, ZERO codes consumed, no create", async () => {
  const { out, attempts } = await expectNoMutation(
    boundFrom(mint({ primaryEmail: "a@example.com", secondaryEmail: "b@example.com" })),
    [
      { email: "a@example.com", password: "Str0ngPass1", role: "primary" },
      { email: "b@example.com", password: "Str0ngPass2", role: "secondary" },
    ],
    { "a@example.com": "111111" }, // b@ code omitted
    { "a@example.com": "111111", "b@example.com": "222222" },
  )
  if (!out.ok) {
    assert.equal(out.status, 400)
    assert.deepEqual(out.failedEmails, ["b@example.com"])
  }
  assert.equal(attempts.length, 0) // the first code is NOT burned when one is missing
})

// --- One bad code among two: needResend, and no account created -------------

test("pair with a wrong second code → 401 needResend, no create/link/bind", async () => {
  const { deps, calls } = makeMgmt()
  const v = makeVerifier({ "a@example.com": "111111", "b@example.com": "222222" })
  const out = await registerModel3WithProof(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      boundEmails: boundFrom(mint({ primaryEmail: "a@example.com", secondaryEmail: "b@example.com" })),
      identities: [
        { email: "a@example.com", password: "Str0ngPass1", role: "primary" },
        { email: "b@example.com", password: "Str0ngPass2", role: "secondary" },
      ],
      codes: { "a@example.com": "111111", "b@example.com": "000000" }, // wrong b@
    },
    { ...deps, verifyPasscode: v.verifyPasscode },
  )
  assert.equal(out.ok, false)
  if (!out.ok) {
    assert.equal(out.status, 401)
    assert.equal(out.needResend, true)
    assert.deepEqual(out.failedEmails, ["b@example.com"])
  }
  assert.equal(calls.create, 0)
  assert.equal(calls.link, 0)
})

// --- Replay: the SAME code cannot create a second account -------------------
// This is the property the reviewer flagged: replay must be defeated by IdP
// CONSUMPTION, not by clearing the cookie. We reuse ONE verifier + ONE tenant
// across two create calls with the SAME cookie and code.

test("replaying the same consumed code creates nothing the second time", async () => {
  const { deps, calls } = makeMgmt()
  const v = makeVerifier({ "a@example.com": "111111" })
  const cookie = mint({ primaryEmail: "a@example.com" }) // a stolen COPY survives
  const args = {
    connectionKey: "per-email" as const,
    connectionName: "sbd-demo-per-email",
    boundEmails: boundFrom(cookie),
    identities: [{ email: "a@example.com", password: "Str0ngPass1", role: "primary" as const }],
    codes: { "a@example.com": "111111" },
  }
  const depsWithProof = { ...deps, verifyPasscode: v.verifyPasscode }

  const first = await registerModel3WithProof(args, depsWithProof)
  assert.equal(first.ok, true)
  assert.equal(calls.create, 1)

  // Replay with the identical (copied) cookie + code. The IdP already consumed
  // the code, so verifyPasscode throws → 401 → still exactly one account.
  const second = await registerModel3WithProof(args, depsWithProof)
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.status, 401)
  assert.equal(calls.create, 1)
})
