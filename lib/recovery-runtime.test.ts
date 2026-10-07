// Runtime tests for unauthenticated brand recovery: the ACTUAL resolver
// (resolveRecoveryFromUsers over Auth0-shaped records) and the reset handler
// core (runRecoveryReset) with injected OTP / lookup / write operations.
// Run with: node --test lib/recovery-runtime.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  resolveCredentialFromCandidates,
  type CandidateAccount,
  type ConnectionKey,
} from "./credential-model.ts"
import {
  readUserBindings,
  resolveRecoveryFromUsers,
  type RecoveryTargetCore,
  type SigninUserRecord,
} from "./brand-signin-core.ts"
import { RECOVERY_NEUTRAL_FAILURE, runRecoveryReset, type RecoveryResetDeps } from "./recovery-reset-core.ts"
import type { PasswordUpdatePlan } from "./password-change.ts"

const NAMES = {
  shared: "sbd-eu",
  "per-email": "sbd-per-email",
  dewalt: "sbd-dewalt",
  stanley: "sbd-stanley",
} as Record<ConnectionKey, string | undefined>
const IDS = {
  shared: undefined,
  "per-email": "con_pe",
  dewalt: "con_dw",
  stanley: "con_st",
} as Record<ConnectionKey, string | undefined>

const P = "prep.primary@example.com"
const S = "prep.secondary@example.com"
const NEW_PW = "Birch-Lantern-2048x"

function binding(brand: "dewalt" | "stanley", email: string, userId: string) {
  return { id: `${brand}-${userId}`, email, connectionKey: brand, auth0UserId: userId, useCase: "per-brand-password", brand }
}

/**
 * The reported UK fixture: canonical root = DeWalt identity (primary P),
 * secondary S added + verified (passwordless identity), Stanley enrolled with S
 * via ownership OTP and linked to the same canonical.
 */
function fixture(): SigninUserRecord {
  return {
    user_id: "auth0|canon",
    email: P,
    email_verified: true,
    identities: [
      { provider: "auth0", connection: "sbd-dewalt", user_id: "canon" },
      { provider: "email", connection: "email", user_id: "pwls", profileData: { email: S, email_verified: true } },
      { provider: "auth0", connection: "sbd-stanley", user_id: "stchild", profileData: { email: S, email_verified: true } },
    ],
    app_metadata: {
      credential_bindings: [binding("dewalt", P, "canon"), binding("stanley", S, "stchild")],
      login_alias_emails: [S],
    },
  }
}

function recover(email: string, siteBrand: "dewalt" | "stanley", users: SigninUserRecord[]) {
  return resolveRecoveryFromUsers({ email, siteBrand, users, names: NAMES, ids: IDS })
}

// --- Cause ------------------------------------------------------------------

test("cause: the pre-fix candidate shape (no verifiedLoginEmails) cannot reach Stanley from the primary", () => {
  const u = fixture()
  const oldShape: CandidateAccount[] = [{
    accountId: u.user_id!,
    bindings: readUserBindings(u),
    identities: [
      { connectionKey: "dewalt", userId: "canon" },
      { connectionKey: "stanley", userId: "stchild" },
    ],
    sharedMatch: false,
  }]
  const r = resolveCredentialFromCandidates({
    email: P,
    siteBrand: "stanley",
    candidates: oldShape,
    configuredKeys: new Set<ConnectionKey>(["shared", "per-email", "dewalt", "stanley"]),
  })
  // Falls through to shared-default; with no shared identity the old resolver
  // returned null → the route's neutral "couldn't reset" 400 the user observed.
  assert.ok(r.ok && r.kind === "shared-default")
})

// --- Both directions --------------------------------------------------------

test("Stanley enrolled with S, recovery via P: resets ONLY the Stanley identity on the canonical", () => {
  const t = recover(P, "stanley", [fixture()])!
  assert.ok(t)
  assert.equal(t.connectionKey, "stanley")
  assert.equal(t.connectionName, "sbd-stanley")
  assert.equal(t.connectionId, "con_st")
  assert.equal(t.auth0UserId, "stchild")
  assert.equal(t.managementUserId, "auth0|canon")
  assert.equal(t.isLinkedSecondary, true)
  assert.equal(t.email, S, "the Stanley identity's own username")
  assert.equal(t.brand, "stanley")
})

test("DeWalt enrolled with P, recovery via S: resets ONLY the DeWalt root identity", () => {
  const t = recover(S, "dewalt", [fixture()])!
  assert.ok(t)
  assert.equal(t.connectionKey, "dewalt")
  assert.equal(t.auth0UserId, "canon")
  assert.equal(t.managementUserId, "auth0|canon")
  assert.equal(t.isLinkedSecondary, false)
  assert.equal(t.email, P)
})

test("exact-binding directions still work, case-insensitively", () => {
  assert.equal(recover(S.toUpperCase(), "stanley", [fixture()])!.auth0UserId, "stchild")
  assert.equal(recover(P.toUpperCase(), "dewalt", [fixture()])!.auth0UserId, "canon")
})

test("never another brand: a DeWalt-only customer gets no Stanley target from either address", () => {
  const u = fixture()
  u.identities = u.identities!.filter((i) => i.connection !== "sbd-stanley")
  u.app_metadata!.credential_bindings = [binding("dewalt", P, "canon")]
  assert.equal(recover(P, "stanley", [u]), null)
  assert.equal(recover(S, "stanley", [u]), null)
  assert.equal(recover(S, "dewalt", [u])!.connectionKey, "dewalt")
})

test("a binding without a real linked identity is not a target", () => {
  const u = fixture()
  u.identities = u.identities!.filter((i) => i.connection !== "sbd-stanley")
  assert.equal(recover(P, "stanley", [u]), null)
})

// --- Security preserved -----------------------------------------------------

test("removed alias (identity unlinked, alias-index cleanup failed) no longer resets", () => {
  const u = fixture()
  u.identities = u.identities!.filter((i) => i.user_id !== "pwls" && i.user_id !== "stchild")
  u.app_metadata!.credential_bindings = [binding("dewalt", P, "canon")]
  // login_alias_emails still lists S
  assert.equal(recover(S, "dewalt", [u]), null)
})

test("an email only in login_alias_emails or unverified proves nothing", () => {
  const u = fixture()
  u.identities = u.identities!.filter((i) => i.user_id !== "pwls" && i.user_id !== "stchild")
  u.app_metadata!.credential_bindings = [binding("dewalt", P, "canon")]
  u.identities!.push({ provider: "auth0", connection: "sbd-per-email", user_id: "unv", profileData: { email: S, email_verified: false } })
  assert.equal(recover(S, "dewalt", [u]), null)
})

test("cross-owner conflict fails closed in BOTH candidate orders (exact on X vs verified on Y)", () => {
  const x = fixture()
  const y: SigninUserRecord = {
    user_id: "auth0|other",
    email: "other@example.com",
    email_verified: true,
    identities: [
      { provider: "auth0", connection: "sbd-stanley", user_id: "other" },
      { provider: "email", connection: "email", user_id: "ope", profileData: { email: P, email_verified: true } },
    ],
    app_metadata: { credential_bindings: [binding("stanley", "other@example.com", "other")] },
  }
  assert.equal(recover(P, "stanley", [x, y]), null)
  assert.equal(recover(P, "stanley", [y, x]), null)
  assert.equal(recover(P, "dewalt", [x, y]), null)
  assert.equal(recover(P, "dewalt", [y, x]), null)
})

test("a standalone passwordless stub for the email is not a conflicting owner", () => {
  const stub: SigninUserRecord = {
    user_id: "email|stub",
    email: P,
    email_verified: true,
    identities: [{ provider: "email", connection: "email", user_id: "stub" }],
  }
  assert.equal(recover(P, "stanley", [stub, fixture()])!.auth0UserId, "stchild")
})

// --- Route core -------------------------------------------------------------

const STANLEY_TARGET = (): RecoveryTargetCore => recover(P, "stanley", [fixture()])!

function deps(over: Partial<RecoveryResetDeps> = {}) {
  const calls: string[] = []
  const plans: PasswordUpdatePlan[] = []
  const d: RecoveryResetDeps = {
    async verifyCode() { calls.push("verify"); return "ok" },
    async resolveTarget() { calls.push("resolve"); return STANLEY_TARGET() },
    async brandNotSetUp() { calls.push("notSetUp"); return false },
    async applyUpdate(plan) { calls.push("apply"); plans.push(plan) },
    ...over,
  }
  // Wrap overrides so they are still recorded.
  const wrap = <K extends keyof RecoveryResetDeps>(k: K, tag: string) => {
    const f = d[k] as (...a: unknown[]) => Promise<unknown>
    ;(d as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
      if (over[k]) calls.push(tag)
      return f(...a)
    }
  }
  wrap("verifyCode", "verify"); wrap("resolveTarget", "resolve"); wrap("brandNotSetUp", "notSetUp")
  return { d, calls, plans }
}

const input = (body: unknown, hasCreds = true) => ({
  body,
  hasCreds,
  market: "uk",
  siteBrandName: "Stanley",
  brandNotSetUpCode: "brand-not-set-up",
  brandNotSetUpMessage: "Stanley sign-in isn't set up for this email yet.",
})
const BODY = { email: P, code: "123456", newPassword: NEW_PW }

test("route: proof → resolve → ONE relink write on the Stanley identity of the canonical; 200 names Stanley", async () => {
  const { d, calls, plans } = deps()
  const r = await runRecoveryReset(input(BODY), d)
  assert.equal(r.status, 200)
  assert.deepEqual(calls, ["verify", "resolve", "apply"])
  assert.equal(plans.length, 1)
  const plan = plans[0] as Extract<PasswordUpdatePlan, { mode: "relink" }>
  assert.equal(plan.mode, "relink")
  assert.equal(plan.primaryUserId, "auth0|canon")
  assert.equal(plan.secondaryUserId, "stchild")
  assert.equal(plan.connectionName, "sbd-stanley")
  assert.deepEqual((r.body as { credential: unknown }).credential, { email: S, scope: "brand", brandName: "Stanley" })
})

test("route: reverse direction writes the DeWalt root identity directly", async () => {
  const { d, plans } = deps({ async resolveTarget() { return recover(S, "dewalt", [fixture()]) } })
  const r = await runRecoveryReset(input({ ...BODY, email: S }), d)
  assert.equal(r.status, 200)
  assert.deepEqual(plans[0], { mode: "direct", patchUserId: "auth0|canon", connectionName: "sbd-dewalt" })
})

test("route: password preflight runs before any proof; weak password consumes no code", async () => {
  const { d, calls } = deps()
  const r = await runRecoveryReset(input({ ...BODY, newPassword: "short" }), d)
  assert.equal(r.status, 400)
  assert.equal((r.body as { code: string }).code, "weak-password")
  assert.deepEqual(calls, [])
})

test("route: bad code is named; nothing resolved or written", async () => {
  const { d, calls } = deps({ async verifyCode() { return "bad-code" } })
  const r = await runRecoveryReset(input(BODY), d)
  assert.equal(r.status, 400)
  assert.equal((r.body as { code: string }).code, "bad-code")
  assert.deepEqual(calls, ["verify"])
})

test("route: missing creds / malformed body / missing code → no proof, no write", async () => {
  for (const [body, creds] of [[BODY, false], [null, true], [{ ...BODY, email: "nope" }, true], [{ ...BODY, code: "" }, true]] as const) {
    const { d, calls } = deps()
    const r = await runRecoveryReset(input(body, creds), d)
    assert.equal(r.status, 400)
    assert.deepEqual(calls, [])
  }
})

test("route: provider error during proof → neutral, nothing resolved", async () => {
  const { d, calls } = deps({ async verifyCode() { throw new Error("upstream 503") } })
  const r = await runRecoveryReset(input(BODY), d)
  assert.deepEqual(r, { status: 400, body: { error: RECOVERY_NEUTRAL_FAILURE } })
  assert.deepEqual(calls, ["verify"])
})

test("route: no target → neutral (or 409 not-set-up); no write", async () => {
  {
    const { d, calls } = deps({ async resolveTarget() { return null } })
    const r = await runRecoveryReset(input(BODY), d)
    assert.deepEqual(r, { status: 400, body: { error: RECOVERY_NEUTRAL_FAILURE } })
    assert.deepEqual(calls, ["verify", "resolve", "notSetUp"])
  }
  {
    const { d, calls } = deps({ async resolveTarget() { return null }, async brandNotSetUp() { return true } })
    const r = await runRecoveryReset(input(BODY), d)
    assert.equal(r.status, 409)
    assert.ok(!calls.includes("apply"))
  }
})

test("route: lookup throws → neutral, no write", async () => {
  const { d, calls } = deps({ async resolveTarget() { throw new Error("timeout") } })
  const r = await runRecoveryReset(input(BODY), d)
  assert.deepEqual(r, { status: 400, body: { error: RECOVERY_NEUTRAL_FAILURE } })
  assert.ok(!calls.includes("apply"))
})

test("route: Auth0 policy rejection maps to the policy message; other write errors stay generic", async () => {
  const policy = Object.assign(new Error("PasswordStrengthError: Password is too weak"), { status: 400 })
  const { d } = deps({ async applyUpdate() { throw policy } })
  const r = await runRecoveryReset(input(BODY), d)
  assert.equal(r.status, 400)
  assert.match(String((r.body as { error: string }).error), /password policy/)
  const { d: d2 } = deps({ async applyUpdate() { throw Object.assign(new Error("boom"), { status: 500 }) } })
  const r2 = await runRecoveryReset(input(BODY), d2)
  assert.equal((r2.body as { error: string }).error, "We couldn't change your password. Please try again.")
})
