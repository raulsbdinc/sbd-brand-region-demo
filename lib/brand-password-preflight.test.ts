import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { preflightBrandEntry, preflightBrandProof } from "./brand-password-preflight.ts"

const EMAIL = "fixture@example.com"

const WEAK: Array<[string, string]> = [
  ["Birch!c", "At least 8 characters."],
  ["birch!cd", "At least one uppercase letter."],
  ["BIRCH!CD", "At least one lowercase letter."],
  ["Birchcde", "At least one special character, such as ! @ # ? or %."],
]

test("entry: every weak proposed password is refused with the shared first-rule message", () => {
  for (const [pw, msg] of WEAK) {
    assert.deepEqual(preflightBrandEntry({ email: EMAIL, password: pw }), {
      ok: false,
      status: 400,
      error: msg,
    })
  }
})

test("entry: valid password passes, digits optional, spaces kept untrimmed", () => {
  assert.deepEqual(preflightBrandEntry({ email: ` ${EMAIL} `, password: "Birch!cd" }), {
    ok: true,
    email: EMAIL,
    password: "Birch!cd",
  })
  const spaced = preflightBrandEntry({ email: EMAIL, password: " Birch cd " })
  assert.equal(spaced.ok, true)
  assert.equal(spaced.ok && spaced.password, " Birch cd ")
})

test("entry: missing or non-string fields keep the presence message", () => {
  for (const body of [{}, { email: EMAIL }, { password: "Birch!cd" }, { email: EMAIL, password: 12345678 }]) {
    const r = preflightBrandEntry(body as Record<string, unknown>)
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.error, "Enter an email and password.")
  }
})

test("proof: weak new password refused for both proof methods, before proof-input checks", () => {
  for (const [pw, msg] of WEAK) {
    for (const body of [
      { method: "password", newPassword: pw, existingPassword: "Maple!ab" },
      { method: "email-code", newPassword: pw, code: "123456" },
      { method: "email-code", newPassword: pw },
    ]) {
      assert.deepEqual(preflightBrandProof(body), { ok: false, status: 400, error: msg })
    }
  }
})

test("proof: valid new password then requires the matching proof input", () => {
  assert.equal(
    preflightBrandProof({ method: "password", newPassword: "Birch!cd" }).ok,
    false,
  )
  assert.equal(
    preflightBrandProof({ method: "email-code", newPassword: "Birch!cd", code: "  " }).ok,
    false,
  )
  assert.deepEqual(
    preflightBrandProof({ method: "email-code", newPassword: "Birch!cd", code: " 123456 " }),
    { ok: true, method: "email-code", newPassword: "Birch!cd", existingPassword: "", code: "123456" },
  )
})

// A pending cross-brand enrollment modelled with the same contract as the
// routes: preflight first, side effects only after it passes.
function pendingEnrollment() {
  const state = {
    handoffMints: 0,
    lookups: 0,
    passwordGrants: 0,
    codesSent: 0,
    codeConsumed: false,
    linked: [] as string[],
  }
  const validCode = "246810"
  const entry = (body: Record<string, unknown>) => {
    const p = preflightBrandEntry(body)
    if (!p.ok) return p.status
    state.lookups++
    state.handoffMints++
    return 200
  }
  const proof = (body: Record<string, unknown>) => {
    const p = preflightBrandProof(body)
    if (!p.ok) return p.status
    state.lookups++
    if (p.method === "password") {
      state.passwordGrants++
    } else {
      if (state.codeConsumed || p.code !== validCode) return 401
      state.codeConsumed = true
    }
    state.linked.push(p.newPassword)
    return 201
  }
  return { state, entry, proof, validCode }
}

test("pending proof: weak replay of the entry body does not refresh the handoff or look anything up", () => {
  const e = pendingEnrollment()
  assert.equal(e.entry({ email: EMAIL, password: "Birch!cd" }), 200)
  assert.equal(e.state.handoffMints, 1)
  assert.equal(e.entry({ email: EMAIL, password: "Birch!c" }), 400)
  assert.equal(e.state.handoffMints, 1)
  assert.equal(e.state.lookups, 1)
})

test("pending proof: weak new password keeps the single-use code valid for the real submission", () => {
  const e = pendingEnrollment()
  e.entry({ email: EMAIL, password: "Birch!cd" })
  for (const [pw] of WEAK) {
    assert.equal(e.proof({ method: "email-code", newPassword: pw, code: e.validCode }), 400)
  }
  assert.equal(e.state.codeConsumed, false)
  assert.equal(e.state.codesSent, 0)
  assert.deepEqual(e.state.linked, [])
  assert.equal(e.proof({ method: "email-code", newPassword: "Birch!cd", code: e.validCode }), 201)
  assert.deepEqual(e.state.linked, ["Birch!cd"])
})

test("pending proof: weak new password never triggers a password grant on the existing credential", () => {
  const e = pendingEnrollment()
  assert.equal(
    e.proof({ method: "password", newPassword: "Birch!c", existingPassword: "Maple!ab" }),
    400,
  )
  assert.equal(e.state.passwordGrants, 0)
  assert.equal(e.state.lookups, 0)
})

// Wiring guard: the real routes must call the preflight before any side effect.
function indexOrFail(src: string, needle: string): number {
  const i = src.indexOf(needle)
  assert.notEqual(i, -1, `expected ${needle} in route`)
  return i
}

test("entry route validates the password before lookups and before minting the proof handoff", () => {
  const src = readFileSync(new URL("../app/api/registration/brand/route.ts", import.meta.url), "utf8")
  const body = src.slice(src.indexOf("export async function POST"))
  const gate = indexOrFail(body, "preflightBrandEntry(")
  for (const effect of [
    "currentBrandCredentialExists(",
    "resolveExistingAccountByEmail(",
    "executeBrandRegistration(",
    "mintJourneyToken(",
    "cookies.set(",
  ]) {
    assert.ok(gate < indexOrFail(body, effect), `preflight must precede ${effect}`)
  }
})

test("proof route validates the new password before lookups, grants and code consumption", () => {
  const src = readFileSync(
    new URL("../app/api/registration/brand/proof/route.ts", import.meta.url),
    "utf8",
  )
  const body = src.slice(src.indexOf("export async function POST"))
  const gate = indexOrFail(body, "preflightBrandProof(")
  for (const effect of [
    "resolveExistingAccountByEmail(",
    "passwordRealmExchange(",
    "proveEnrollmentOwnershipOtp(",
    "executeBrandLink(",
  ]) {
    assert.ok(gate < indexOrFail(body, effect), `preflight must precede ${effect}`)
  }
})
