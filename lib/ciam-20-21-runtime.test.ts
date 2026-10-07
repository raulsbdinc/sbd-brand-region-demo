// Runtime regression tests for CIAM-20/21: the ACTUAL resolver bridge
// (resolveSigninFromUsers over Auth0-shaped user records), the password sign-in
// handler core (one grant + post-grant owner check) and the brand passcode
// start handler core (one deadline, truthful status, send + handoff only on
// 200), each with injected provider calls.
// Run with: node --test lib/ciam-20-21-runtime.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import type { ConnectionKey } from "./credential-model.ts"
import {
  brandIdentityLoginEmail,
  grantSubjectMatchesOwner,
  readUserBindings,
  resolveSigninFromUsers,
  runBrandPasswordSignin,
  verifiedLoginEmailsOfUser,
  type SigninCredentialResolution,
  type SigninUserRecord,
} from "./brand-signin-core.ts"
import { runBrandPasscodeStart, type BrandPasscodeStartDeps } from "./passcode-start-core.ts"
import type { PasswordGrantOutcome } from "./password-grant-core.ts"

const NAMES = {
  shared: undefined,
  "per-email": "sbd-per-email",
  dewalt: "sbd-dewalt",
  stanley: "sbd-stanley",
} as Record<ConnectionKey, string | undefined>

const A = "primary-a@example.com"
const B = "secondary-b@example.com"

function binding(brand: "dewalt" | "stanley", email: string, userId: string) {
  return { id: `${brand}-${userId}`, email, connectionKey: brand, auth0UserId: userId, useCase: "per-brand-password", brand }
}

/** DeWalt UK enrolled with A (root), B added+verified, Stanley UK enrolled with B. */
function reverseCaseUser(): SigninUserRecord {
  return {
    user_id: "auth0|dwa",
    email: A,
    email_verified: true,
    identities: [
      { provider: "auth0", connection: "sbd-dewalt", user_id: "dwa" },
      { provider: "email", connection: "email", user_id: "emb", profileData: { email: B, email_verified: true } },
      { provider: "auth0", connection: "sbd-stanley", user_id: "stb", profileData: { email: B, email_verified: true } },
    ],
    app_metadata: {
      credential_bindings: [binding("dewalt", A, "dwa"), binding("stanley", B, "stb")],
      login_alias_emails: [B],
    },
  }
}

function resolve(email: string, siteBrand: "dewalt" | "stanley", users: SigninUserRecord[]) {
  return resolveSigninFromUsers({ email, siteBrand, users, names: NAMES })
}

test("fixture bindings survive the real sanitizer", () => {
  assert.equal(readUserBindings(reverseCaseUser()).length, 2)
})

// --- Bridge: owner, brand identity and its own username --------------------

test("reverse case: primary A signs in to Stanley with Stanley's identity username B", () => {
  const r = resolve(A, "stanley", [reverseCaseUser()])
  assert.equal(r.kind, "resolved")
  if (r.kind !== "resolved") return
  assert.equal(r.connectionKey, "stanley")
  assert.equal(r.connectionName, "sbd-stanley")
  assert.equal(r.loginEmail, B)
  assert.equal(r.accountId, "auth0|dwa")
})

test("reverse case: secondary B signs in to DeWalt with the root DeWalt username A", () => {
  const r = resolve(B, "dewalt", [reverseCaseUser()])
  assert.equal(r.kind, "resolved")
  if (r.kind !== "resolved") return
  assert.equal(r.connectionKey, "dewalt")
  assert.equal(r.loginEmail, A)
  assert.equal(r.accountId, "auth0|dwa")
})

test("typed email case does not matter", () => {
  const r = resolve("Primary-A@EXAMPLE.com", "stanley", [reverseCaseUser()])
  assert.equal(r.kind === "resolved" && r.loginEmail, B)
})

test("username is the brand identity's own profile email, not a stale binding email", () => {
  const user = reverseCaseUser()
  ;(user.app_metadata!.credential_bindings as { email: string }[])[1].email = "stale@example.com"
  const r = resolve(A, "stanley", [user])
  assert.equal(r.kind === "resolved" && r.loginEmail, B)
})

test("brandIdentityLoginEmail never returns another brand's identity", () => {
  const user = reverseCaseUser()
  const stanley = readUserBindings(user).find((b) => b.connectionKey === "stanley")!
  assert.equal(brandIdentityLoginEmail(user, stanley, NAMES), B)
  const forged = { ...stanley, auth0UserId: "dwa" } // DeWalt's identity id under Stanley's key
  assert.equal(brandIdentityLoginEmail(user, forged, NAMES), "")
})

test("a customer enrolled only in DeWalt never resolves on Stanley (CIAM-20 other brand)", () => {
  const user = reverseCaseUser()
  user.identities = user.identities!.filter((i) => i.connection !== "sbd-stanley")
  user.app_metadata!.credential_bindings = [binding("dewalt", A, "dwa")]
  assert.equal(resolve(A, "stanley", [user]).kind, "shared-default")
  assert.equal(resolve(B, "stanley", [user]).kind, "shared-default")
})

test("a never-registered email resolves to nothing", () => {
  assert.equal(resolve("nobody@example.com", "dewalt", [reverseCaseUser()]).kind, "shared-default")
})

// --- Verified-email derivation and actual removal semantics ----------------

/** DeWalt-only customer with secondary C linked as a passwordless identity. */
function dwWithSecondaryC(): SigninUserRecord {
  return {
    user_id: "auth0|dwx",
    email: A,
    email_verified: true,
    identities: [
      { provider: "auth0", connection: "sbd-dewalt", user_id: "dwx" },
      { provider: "email", connection: "email", user_id: "emc", profileData: { email: "c@example.com", email_verified: true } },
    ],
    app_metadata: { credential_bindings: [binding("dewalt", A, "dwx")], login_alias_emails: ["c@example.com"] },
  }
}

test("a verified linked secondary signs in before removal", () => {
  const r = resolve("c@example.com", "dewalt", [dwWithSecondaryC()])
  assert.equal(r.kind === "resolved" && r.loginEmail, A)
})

test("after the real remove-email result (identity unlinked, alias cleanup FAILED) the email stops resolving", () => {
  // DELETE /api/account/identities unlinks the identity; the alias-index cleanup
  // is best-effort, so model the worst case where login_alias_emails kept C and
  // the orphan record (the unlinked identity re-materialized) was not deleted.
  const after = dwWithSecondaryC()
  after.identities = after.identities!.filter((i) => i.provider !== "email")
  const orphan: SigninUserRecord = {
    user_id: "email|emc",
    email: "c@example.com",
    email_verified: true,
    identities: [{ provider: "email", connection: "email", user_id: "emc" }],
  }
  assert.deepEqual(verifiedLoginEmailsOfUser(after), [A])
  assert.deepEqual(verifiedLoginEmailsOfUser(orphan), [])
  assert.equal(resolve("c@example.com", "dewalt", [after, orphan]).kind, "shared-default")
  // The primary keeps working.
  assert.equal(resolve(A, "dewalt", [after, orphan]).kind, "resolved")
})

test("an email only in login_alias_emails, unverified, or on a non-Google social identity proves nothing", () => {
  const user: SigninUserRecord = {
    user_id: "auth0|dwy",
    email: A,
    email_verified: true,
    identities: [
      { provider: "auth0", connection: "sbd-dewalt", user_id: "dwy" },
      { provider: "auth0", connection: "sbd-stanley", user_id: "uv", profileData: { email: "unverified@example.com", email_verified: false } },
      { provider: "facebook", connection: "facebook", user_id: "fb", profileData: { email: "fb@example.com", email_verified: true } },
      { provider: "google-oauth2", connection: "google-oauth2", user_id: "g1", profileData: { email: "g-unverified@example.com", email_verified: false } },
    ],
    app_metadata: { credential_bindings: [binding("dewalt", A, "dwy")], login_alias_emails: ["metadata-only@example.com"] },
  }
  assert.deepEqual(verifiedLoginEmailsOfUser(user), [A])
  for (const e of ["metadata-only@example.com", "unverified@example.com", "fb@example.com", "g-unverified@example.com"]) {
    assert.equal(resolve(e, "dewalt", [user]).kind, "shared-default", e)
  }
})

test("an explicitly linked, verified Google email is an owned identifier", () => {
  const user = dwWithSecondaryC()
  user.identities!.push({ provider: "google-oauth2", connection: "google-oauth2", user_id: "g2", profileData: { email: "me@gmail.com", email_verified: true } })
  const r = resolve("me@gmail.com", "dewalt", [user])
  assert.equal(r.kind === "resolved" && r.loginEmail, A)
})

test("an unverified root email does not count, but the exact brand binding still resolves", () => {
  const user = dwWithSecondaryC()
  user.email_verified = false
  assert.ok(!verifiedLoginEmailsOfUser(user).includes(A))
  assert.equal(resolve(A, "dewalt", [user]).kind, "resolved")
})

// --- Cross-owner conflict checked BEFORE exact binding ---------------------

test("exact binding on X vs verified claim on Y is ambiguous in BOTH candidate orders", () => {
  const x = dwWithSecondaryC() // exact DeWalt binding for A
  const y: SigninUserRecord = {
    user_id: "google-oauth2|y",
    email: "other@example.com",
    email_verified: true,
    identities: [
      { provider: "google-oauth2", connection: "google-oauth2", user_id: "y" },
      { provider: "auth0", connection: "sbd-stanley", user_id: "sty", profileData: { email: A, email_verified: true } },
    ],
  }
  assert.equal(resolve(A, "dewalt", [x, y]).kind, "ambiguous")
  assert.equal(resolve(A, "dewalt", [y, x]).kind, "ambiguous")
})

test("two distinct customers both claiming an alias is ambiguous", () => {
  const x = dwWithSecondaryC()
  const y = dwWithSecondaryC()
  y.user_id = "auth0|other"
  y.email = "y@example.com"
  y.identities = [
    { provider: "auth0", connection: "sbd-dewalt", user_id: "other" },
    { provider: "email", connection: "email", user_id: "emc2", profileData: { email: "c@example.com" } },
  ]
  y.app_metadata = { credential_bindings: [binding("dewalt", "y@example.com", "other")] }
  assert.equal(resolve("c@example.com", "dewalt", [x, y]).kind, "ambiguous")
  assert.equal(resolve("c@example.com", "dewalt", [y, x]).kind, "ambiguous")
})

// --- Password handler core: one grant, post-grant owner check --------------

function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`
}

function passwordDeps(resolution: SigninCredentialResolution | Error, grant: PasswordGrantOutcome) {
  const grants: { username: string; connectionKey: ConnectionKey }[] = []
  return {
    grants,
    deps: {
      now: Date.now,
      resolve: async () => {
        if (resolution instanceof Error) throw resolution
        return resolution
      },
      grant: async (args: { username: string; password: string; connectionKey: ConnectionKey; deadlineAt: number }) => {
        grants.push({ username: args.username, connectionKey: args.connectionKey })
        return grant
      },
    },
  }
}

const INPUT = { email: A, password: "Birch!cd", lookupBudgetMs: 1000, signinBudgetMs: 2000 }

test("password: ONE grant on the brand realm with the brand identity's username; canonical sub opens a session", async () => {
  const resolution = resolve(A, "stanley", [reverseCaseUser()])
  const tokens = { access_token: "at", id_token: idToken({ sub: "auth0|dwa", email: A }) }
  const { grants, deps } = passwordDeps(resolution, { kind: "ok", tokens })
  const out = await runBrandPasswordSignin(INPUT, deps)
  assert.deepEqual(grants, [{ username: B, connectionKey: "stanley" }])
  assert.equal(out.kind, "session")
  if (out.kind === "session") assert.equal(out.sub, "auth0|dwa")
})

test("password: a returned sub that is not the selected owner gets no session (child id or stranger)", async () => {
  const resolution = resolve(A, "stanley", [reverseCaseUser()])
  for (const sub of ["auth0|stb", "auth0|stranger", undefined]) {
    const { grants, deps } = passwordDeps(resolution, { kind: "ok", tokens: { access_token: "at", id_token: idToken({ sub }) } })
    const out = await runBrandPasswordSignin(INPUT, deps)
    assert.equal(grants.length, 1)
    assert.equal(out.kind, "failure")
    if (out.kind === "failure") assert.equal(out.status, 401)
  }
})

test("password: ambiguous/unregistered make NO grant (401); failed lookup is 503 with no grant", async () => {
  for (const r of [{ kind: "ambiguous" }, { kind: "shared-default" }] as SigninCredentialResolution[]) {
    const { grants, deps } = passwordDeps(r, { kind: "refused" })
    const out = await runBrandPasswordSignin(INPUT, deps)
    assert.equal(grants.length, 0)
    assert.equal(out.kind === "failure" && out.status, 401)
  }
  for (const r of [{ kind: "unavailable" } as SigninCredentialResolution, new Error("mgmt down")]) {
    const { grants, deps } = passwordDeps(r, { kind: "refused" })
    const out = await runBrandPasswordSignin(INPUT, deps)
    assert.equal(grants.length, 0)
    assert.equal(out.kind === "failure" && out.status, 503)
  }
})

test("password: wrong password 401 and provider throttling 429, single grant each", async () => {
  const resolution = resolve(B, "dewalt", [reverseCaseUser()])
  const refused = passwordDeps(resolution, { kind: "refused" })
  assert.equal((await runBrandPasswordSignin(INPUT, refused.deps)).kind === "failure", true)
  assert.equal(refused.grants.length, 1)
  const throttled = passwordDeps(resolution, { kind: "throttled", retryAfterSeconds: 30 })
  const out = await runBrandPasswordSignin(INPUT, throttled.deps)
  assert.equal(out.kind === "failure" && out.status, 429)
  assert.equal(throttled.grants.length, 1)
})

test("grantSubjectMatchesOwner requires the exact canonical id", () => {
  assert.equal(grantSubjectMatchesOwner("auth0|dwa", "auth0|dwa"), true)
  assert.equal(grantSubjectMatchesOwner("auth0|dwa", ""), false)
  assert.equal(grantSubjectMatchesOwner(42, "auth0|dwa"), false)
})

// --- Passcode start handler core ------------------------------------------

function startDeps(over: Partial<BrandPasscodeStartDeps> = {}) {
  const calls = { resolve: 0, snapshot: 0, send: 0, sentTo: [] as string[], signal: null as AbortSignal | null }
  const deps: BrandPasscodeStartDeps = {
    now: Date.now,
    resolve: async (email) => {
      calls.resolve++
      return resolve(email, "stanley", [reverseCaseUser()])
    },
    carryForward: () => null,
    snapshot: async () => {
      calls.snapshot++
      return ["email|pre"]
    },
    send: async (email, opts) => {
      calls.send++
      calls.sentTo.push(email)
      calls.signal = opts.signal
    },
    ...over,
  }
  return { calls, deps }
}

const startInput = (email: unknown, extra: Partial<{ hasCreds: boolean; budgetMs: number }> = {}) => ({
  body: { email },
  siteBrand: "stanley",
  hasCreds: true,
  handoffTtlSeconds: 600,
  ...extra,
})

test("start 200: ONE send to the email actually entered, handoff only now, snapshot taken before send", async () => {
  const order: string[] = []
  const { calls, deps } = startDeps({
    snapshot: async () => (order.push("snapshot"), ["email|pre"]),
    send: async (email) => {
      order.push("send")
      calls.sentTo.push(email)
    },
  })
  const out = await runBrandPasscodeStart(startInput("Secondary-B@Example.com"), deps)
  assert.equal(out.status, 200)
  assert.deepEqual(calls.sentTo, [B])
  assert.deepEqual(order, ["snapshot", "send"])
  assert.equal(out.handoff?.email, B)
  assert.deepEqual(out.handoff?.preExistingPasswordlessSubs, ["email|pre"])
})

test("start resend inside a valid handoff keeps the original snapshot and iat", async () => {
  const { calls, deps } = startDeps({ carryForward: () => ({ iat: 1000, preExistingPasswordlessSubs: ["email|orig"] }) })
  const out = await runBrandPasscodeStart(startInput(A), deps)
  assert.equal(out.status, 200)
  assert.equal(calls.snapshot, 0)
  assert.equal(out.handoff?.iat, 1000)
  assert.deepEqual(out.handoff?.preExistingPasswordlessSubs, ["email|orig"])
})

test("start 400 for missing/malformed email; nothing looked up or sent", async () => {
  for (const email of [undefined, "", "not-an-email", 7]) {
    const { calls, deps } = startDeps()
    const out = await runBrandPasscodeStart(startInput(email), deps)
    assert.equal(out.status, 400)
    assert.equal(out.handoff, undefined)
    assert.equal(calls.resolve + calls.send, 0)
  }
})

test("start 404 for never-registered, other-brand-only and wrong region; no send, no handoff", async () => {
  const dwOnly = reverseCaseUser()
  dwOnly.identities = dwOnly.identities!.filter((i) => i.connection !== "sbd-stanley")
  dwOnly.app_metadata!.credential_bindings = [binding("dewalt", A, "dwa")]
  const cases: [string, SigninUserRecord[]][] = [
    ["nobody@example.com", [reverseCaseUser()]],
    [A, [dwOnly]],
    [A, []], // the regional tenant's lookup has no such customer
  ]
  for (const [email, users] of cases) {
    const { calls, deps } = startDeps({ resolve: async (e) => resolve(e, "stanley", users) })
    const out = await runBrandPasscodeStart(startInput(email), deps)
    assert.equal(out.status, 404, email)
    assert.equal(out.body.code === "not-registered", true)
    assert.equal(out.handoff, undefined)
    assert.equal(calls.send + calls.snapshot, 0)
  }
})

test("start 409 for a cross-customer conflict; no send", async () => {
  const { calls, deps } = startDeps({ resolve: async () => ({ kind: "ambiguous" }) })
  const out = await runBrandPasscodeStart(startInput(A), deps)
  assert.equal(out.status, 409)
  assert.equal(calls.send, 0)
})

test("start 503 (never 404) when creds are missing, the lookup throws or is unavailable", async () => {
  const variants: [Partial<BrandPasscodeStartDeps>, Partial<{ hasCreds: boolean }>][] = [
    [{}, { hasCreds: false }],
    [{ resolve: async () => { throw new Error("mgmt 500") } }, {}],
    [{ resolve: async () => ({ kind: "unavailable" }) }, {}],
  ]
  for (const [over, extra] of variants) {
    const { calls, deps } = startDeps(over)
    const out = await runBrandPasscodeStart(startInput(A, extra), deps)
    assert.equal(out.status, 503)
    assert.equal(out.body.code === "provider-unavailable", true)
    assert.equal(out.handoff, undefined)
    assert.equal(calls.send, 0)
  }
})

test("start 503 with no send when the snapshot fails (provenance is never skipped)", async () => {
  for (const snapshot of [async () => null, async () => { throw new Error("x") }]) {
    const { calls, deps } = startDeps({ snapshot })
    const out = await runBrandPasscodeStart(startInput(A), deps)
    assert.equal(out.status, 503)
    assert.equal(calls.send, 0)
  }
})

test("deadline exhausted BEFORE send: a hanging lookup or snapshot is cut off, no send", async () => {
  const hang = () => new Promise<never>(() => {})
  for (const over of [{ resolve: hang }, { snapshot: hang }] as Partial<BrandPasscodeStartDeps>[]) {
    const { calls, deps } = startDeps(over)
    const t0 = Date.now()
    const out = await runBrandPasscodeStart(startInput(A, { budgetMs: 40 }), deps)
    assert.equal(out.status, 503)
    assert.equal(calls.send, 0)
    assert.ok(Date.now() - t0 < 1000)
  }
})

test("deadline exhausted exactly at the send step: no send", async () => {
  let t = 0
  const { calls, deps } = startDeps({
    now: () => t,
    snapshot: async () => {
      t += 1000 // the snapshot consumed the whole budget
      return []
    },
  })
  const out = await runBrandPasscodeStart(startInput(A, { budgetMs: 500 }), deps)
  assert.equal(out.status, 503)
  assert.equal(calls.send, 0)
})

test("send timeout: the send gets the remaining budget as its abort signal and maps to 503", async () => {
  const { calls, deps } = startDeps({
    send: (_email, opts) => {
      calls.send++
      return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(opts.signal.reason)))
    },
  })
  const out = await runBrandPasscodeStart(startInput(A, { budgetMs: 60 }), deps)
  assert.equal(out.status, 503)
  assert.equal(calls.send, 1)
  assert.equal(out.handoff, undefined)
})

test("send throttled is 429; any other send failure is 503; neither sets a handoff", async () => {
  const throttled = startDeps({ send: async () => { throw Object.assign(new Error("429"), { status: 429 }) } })
  const t = await runBrandPasscodeStart(startInput(A), throttled.deps)
  assert.equal(t.status, 429)
  assert.equal(t.handoff, undefined)
  const failed = startDeps({ send: async () => { throw Object.assign(new Error("500"), { status: 500 }) } })
  const f = await runBrandPasscodeStart(startInput(A), failed.deps)
  assert.equal(f.status, 503)
  assert.equal(f.handoff, undefined)
})
