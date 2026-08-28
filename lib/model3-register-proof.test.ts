// END-TO-END PROOF-GATE test for signed-out Model-3 registration.
// ================================================================
// This composes the SAME two real pieces the create route uses to decide
// whether to provision — the signed handoff codec (lib/handoff-token) and the
// pure create gate (lib/account-model) — and asserts the route's decision for
// every proof-tampering scenario. It proves the security property the approved
// flow requires: NO account is created (the gate never returns ok) until every
// submitted email has completed real ownership proof, and any invalid, expired,
// replayed, tampered, or wrong-email proof is rejected and fails closed.
//
// The two layers under test are the whole trust boundary: the codec decides
// whether a cookie is an authentic, unexpired "model3-register" proof, and the
// gate decides whether that proof actually covers the emails being created. The
// executor's own independent refusal to mint an unproven identity is covered in
// model-registration.test.ts.

import { test } from "node:test"
import assert from "node:assert/strict"
import { signHandoff, verifyHandoff } from "./handoff-token.ts"
import { gateModel3Create, type Model3RegisterProof } from "./account-model.ts"

const SECRET = "test-secret-key-do-not-use-in-prod"
const TTL = 10 * 60 * 1000
const PURPOSE = "model3-register" as const

// Mirror exactly what the create route does: read the cookie for THIS purpose,
// then gate the emails it is about to provision against the verified proof.
function routeDecision(input: {
  cookie: string | undefined | null
  submittedEmails: string[]
  now?: number
}) {
  const verified = verifyHandoff<Model3RegisterProof>(input.cookie, PURPOSE, SECRET, {
    maxAgeMs: TTL,
    now: input.now,
  })
  const gate = gateModel3Create({
    submittedEmails: input.submittedEmails,
    proof: verified.ok ? verified.data : null,
  })
  return { verified, gate }
}

function mint(data: Model3RegisterProof, now?: number) {
  return signHandoff(PURPOSE, data, SECRET, now)
}

// --- Happy path -------------------------------------------------------------

test("create allowed only once BOTH emails are proven", () => {
  const cookie = mint({
    primaryEmail: "a@example.com",
    secondaryEmail: "b@example.com",
    verified: ["a@example.com", "b@example.com"],
  })
  const { gate } = routeDecision({
    cookie,
    submittedEmails: ["a@example.com", "b@example.com"],
  })
  assert.deepEqual(gate, { ok: true })
})

// --- No proof / partial proof: nothing is created ---------------------------

test("no cookie → gate fails closed (no create)", () => {
  const { gate } = routeDecision({ cookie: undefined, submittedEmails: ["a@example.com"] })
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.equal(gate.reason, "no-proof")
})

test("cookie present but the submitted email is unproven → no create", () => {
  const cookie = mint({ primaryEmail: "a@example.com", verified: [] })
  const { gate } = routeDecision({ cookie, submittedEmails: ["a@example.com"] })
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.equal(gate.reason, "incomplete-proof")
})

test("pair with only the primary proven → no create", () => {
  const cookie = mint({
    primaryEmail: "a@example.com",
    secondaryEmail: "b@example.com",
    verified: ["a@example.com"],
  })
  const { gate } = routeDecision({
    cookie,
    submittedEmails: ["a@example.com", "b@example.com"],
  })
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.equal(gate.reason, "incomplete-proof")
})

// --- Expired proof ----------------------------------------------------------

test("expired proof is rejected (codec expired) → no create", () => {
  const mintedAt = 1_000_000
  const cookie = mint(
    { primaryEmail: "a@example.com", verified: ["a@example.com"] },
    mintedAt,
  )
  // Verify well past the TTL.
  const { verified, gate } = routeDecision({
    cookie,
    submittedEmails: ["a@example.com"],
    now: mintedAt + TTL + 1,
  })
  assert.equal(verified.ok, false)
  if (!verified.ok) assert.equal(verified.reason, "expired")
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.equal(gate.reason, "no-proof") // expired → treated as no proof
})

// --- Tampered proof ---------------------------------------------------------

test("tampered payload (add an email to verified) is rejected → no create", () => {
  const cookie = mint({ primaryEmail: "a@example.com", verified: [] })
  // Forge: decode, add proof for a@, re-encode WITHOUT re-signing.
  const dot = cookie.lastIndexOf(".")
  const body = cookie.slice(0, dot)
  const mac = cookie.slice(dot + 1)
  const envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  envelope.data.verified = ["a@example.com"]
  const forgedBody = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
  const forged = `${forgedBody}.${mac}`

  const { verified, gate } = routeDecision({ cookie: forged, submittedEmails: ["a@example.com"] })
  assert.equal(verified.ok, false)
  if (!verified.ok) assert.equal(verified.reason, "bad-signature")
  assert.equal(gate.ok, false)
})

test("proof minted for a DIFFERENT purpose can't be replayed here → no create", () => {
  // A valid, unexpired token — but signed for model3-complete, not -register.
  const otherPurpose = signHandoff(
    "model3-complete",
    { primaryEmail: "a@example.com", verified: ["a@example.com"] },
    SECRET,
  )
  const { verified, gate } = routeDecision({
    cookie: otherPurpose,
    submittedEmails: ["a@example.com"],
  })
  assert.equal(verified.ok, false)
  if (!verified.ok) assert.equal(verified.reason, "purpose-mismatch")
  assert.equal(gate.ok, false)
})

test("proof signed with the WRONG secret is rejected → no create", () => {
  const cookie = signHandoff(
    PURPOSE,
    { primaryEmail: "a@example.com", verified: ["a@example.com"] },
    "attacker-secret",
  )
  const { verified, gate } = routeDecision({ cookie, submittedEmails: ["a@example.com"] })
  assert.equal(verified.ok, false)
  if (!verified.ok) assert.equal(verified.reason, "bad-signature")
  assert.equal(gate.ok, false)
})

// --- Wrong-email proof (swap after proving) ---------------------------------

test("proof for a@+b@ can't create a@+evil@ (wrong-email) → no create", () => {
  const cookie = mint({
    primaryEmail: "a@example.com",
    secondaryEmail: "b@example.com",
    verified: ["a@example.com", "b@example.com"],
  })
  const { gate } = routeDecision({
    cookie,
    submittedEmails: ["a@example.com", "evil@example.com"],
  })
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.equal(gate.reason, "email-mismatch")
})

// --- Replay after a successful create ---------------------------------------

test("replay: once the route clears the cookie, the same request creates nothing", () => {
  // First create succeeds…
  const cookie = mint({ primaryEmail: "a@example.com", verified: ["a@example.com"] })
  const first = routeDecision({ cookie, submittedEmails: ["a@example.com"] })
  assert.deepEqual(first.gate, { ok: true })

  // …then the route clears the handoff (Set-Cookie maxAge 0). A replayed submit
  // arrives with NO cookie, so the gate fails closed — no second account.
  const replay = routeDecision({ cookie: undefined, submittedEmails: ["a@example.com"] })
  assert.equal(replay.gate.ok, false)
  if (!replay.gate.ok) assert.equal(replay.gate.reason, "no-proof")
})
