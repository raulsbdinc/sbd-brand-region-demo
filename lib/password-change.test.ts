import { test } from "node:test"
import assert from "node:assert/strict"
import {
  bareUserId,
  canSubmitPasswordChange,
  mapPasswordUpdateError,
  resolvePasswordChangeTarget,
  toManagementUserId,
  validateNewPassword,
  type PasswordChangeSelector,
} from "./password-change.ts"
import type {
  ConnectionKey,
  CredentialBinding,
  LinkedDbIdentity,
} from "./credential-model.ts"

const ALL_KEYS: ReadonlySet<ConnectionKey> = new Set<ConnectionKey>([
  "shared",
  "per-email",
  "dewalt",
  "stanley",
])

function binding(over: Partial<CredentialBinding>): CredentialBinding {
  return {
    id: "b1",
    email: "alt@example.com",
    connectionKey: "per-email",
    auth0UserId: "auth0|per-email-1",
    useCase: "per-email-password",
    ...over,
  }
}

function identity(
  connectionKey: ConnectionKey,
  userId: string,
): LinkedDbIdentity {
  return { connectionKey, userId }
}

// --- SHARED target (Models 1 & 2) -------------------------------------------

test("Model 1/2 shared: one shared identity resolves to the account password", () => {
  const res = resolvePasswordChangeTarget({
    selector: { scope: "shared" },
    bindings: [],
    identities: [identity("shared", "auth0|primary")],
    configuredKeys: ALL_KEYS,
    rootEmail: "Primary@Example.com",
    rootUserId: "auth0|primary",
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "shared")
    assert.equal(res.target.auth0UserId, "auth0|primary")
    assert.equal(res.target.managementUserId, "auth0|primary")
    assert.equal(res.target.isLinkedSecondary, false)
    assert.equal(res.target.email, "primary@example.com") // normalized
    assert.equal(res.target.label, "Account password")
    assert.equal(res.target.brand, undefined)
  }
})

test("shared fails closed when the account has NO shared database identity (case-3/4-only)", () => {
  const res = resolvePasswordChangeTarget({
    selector: { scope: "shared" },
    bindings: [binding({})],
    identities: [identity("per-email", "auth0|per-email-1")],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|per-email-1",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "no-shared-credential")
})

test("shared fails closed on more than one shared identity (ambiguous)", () => {
  const res = resolvePasswordChangeTarget({
    selector: { scope: "shared" },
    bindings: [],
    identities: [
      identity("shared", "auth0|a"),
      identity("shared", "auth0|b"),
    ],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|a",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "ambiguous-shared")
})

test("shared fails closed when the shared connection is not configured", () => {
  const res = resolvePasswordChangeTarget({
    selector: { scope: "shared" },
    bindings: [],
    identities: [identity("shared", "auth0|primary")],
    configuredKeys: new Set<ConnectionKey>(["per-email"]),
    rootEmail: "primary@example.com",
    rootUserId: "auth0|primary",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "not-configured")
})

// --- Model 3 per-email target ------------------------------------------------

test("Model 3 per-email: a backed, owned binding resolves to that exact email", () => {
  const b = binding({
    id: "pe-1",
    email: "alt@example.com",
    connectionKey: "per-email",
    auth0UserId: "auth0|pe",
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: "pe-1" },
    bindings: [b],
    identities: [identity("per-email", "auth0|pe")],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|pe",
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "per-email")
    assert.equal(res.target.email, "alt@example.com")
    assert.equal(res.target.auth0UserId, "auth0|pe")
    assert.equal(res.target.managementUserId, "auth0|pe")
    assert.equal(res.target.isLinkedSecondary, false)
    assert.equal(res.target.label, "Password for alt@example.com")
    assert.equal(res.target.brand, undefined)
  }
})

// --- Model 4 per-brand target ------------------------------------------------

test("Model 4 per-brand: a DeWalt binding resolves with its brand + label", () => {
  const b = binding({
    id: "dw-1",
    email: "brand@example.com",
    connectionKey: "dewalt",
    auth0UserId: "auth0|dw",
    useCase: "per-brand-password",
    brand: "dewalt",
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: "dw-1" },
    bindings: [b],
    identities: [identity("dewalt", "auth0|dw")],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|dw",
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "dewalt")
    assert.equal(res.target.brand, "dewalt")
    assert.equal(res.target.managementUserId, "auth0|dw")
    assert.equal(res.target.isLinkedSecondary, false)
    assert.equal(res.target.label, "DeWalt password")
    assert.equal(res.target.email, "brand@example.com")
  }
})

test("Model 4 Stanley binding is labelled independently of any deployment brand", () => {
  const b = binding({
    id: "st-1",
    email: "s@example.com",
    connectionKey: "stanley",
    auth0UserId: "auth0|st",
    useCase: "per-brand-password",
    brand: "stanley",
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: "st-1" },
    bindings: [b],
    identities: [identity("stanley", "auth0|st")],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|st",
  })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.target.label, "Stanley password")
})

// --- Unowned / tampered / social fail-closed --------------------------------

test("unowned/tampered binding id (not on the account) is refused", () => {
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: "does-not-exist" },
    bindings: [binding({ id: "pe-1" })],
    identities: [identity("per-email", "auth0|per-email-1")],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|per-email-1",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "not-found")
})

test("a binding with NO backing linked identity is refused (unbacked)", () => {
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: "pe-1" },
    bindings: [binding({ id: "pe-1", auth0UserId: "auth0|orphan" })],
    identities: [], // nothing backs it
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|primary",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "unbacked")
})

test("a binding on an unconfigured connection is refused", () => {
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: "dw-1" },
    bindings: [
      binding({
        id: "dw-1",
        connectionKey: "dewalt",
        auth0UserId: "auth0|dw",
        useCase: "per-brand-password",
        brand: "dewalt",
      }),
    ],
    identities: [identity("dewalt", "auth0|dw")],
    configuredKeys: new Set<ConnectionKey>(["shared"]), // dewalt not configured
    rootEmail: "primary@example.com",
    rootUserId: "auth0|dw",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "not-configured")
})

test("a social identity can never be a change target (no selector reaches it)", () => {
  // The ONLY selectors are shared + bindingId. A social identity has no
  // database binding, so a bindingId that names it cannot resolve, and the
  // shared path only considers auth0 database identities. An empty/garbage
  // selector fails closed as invalid.
  const social = { provider: "google-oauth2" } as unknown as PasswordChangeSelector
  const res = resolvePasswordChangeTarget({
    selector: social,
    bindings: [],
    identities: [identity("shared", "auth0|primary")],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: "auth0|primary",
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "invalid-selector")
})

// --- managementUserId: provider-qualification for the Management PATCH -------
// REGRESSION (live defect): the route PATCHed with the PROVIDER-LESS identity
// user_id / binding auth0UserId, but Auth0 Management requires "auth0|<id>", so
// a valid Model 4 target returned HTTP 400 after ROPG already verified the
// current password. The planner must keep auth0UserId provider-less (ownership
// matching) AND expose a provider-QUALIFIED managementUserId for the PATCH.

test("toManagementUserId qualifies a provider-less id and passes a qualified one through", () => {
  assert.equal(
    toManagementUserId("6a97383cec1273ecd6faca5b"),
    "auth0|6a97383cec1273ecd6faca5b",
  )
  // Already-qualified → unchanged (never double-prefixed).
  assert.equal(
    toManagementUserId("auth0|6a97383cec1273ecd6faca5b"),
    "auth0|6a97383cec1273ecd6faca5b",
  )
  // Social provider prefix is preserved (defensive; never a change target).
  assert.equal(toManagementUserId("google-oauth2|123"), "google-oauth2|123")
  // Blank stays blank for the caller's own fail-closed handling.
  assert.equal(toManagementUserId(""), "")
})

test("Model 4 primary (EXACT live shape): provider-less binding+identity, qualified managementUserId", () => {
  // Root sub auth0|6a97…; credential_bindings.auth0UserId and the linked
  // identity user_id are BOTH provider-less and equal to the root's bare id
  // (the DeWalt identity IS this account's primary database identity).
  const bareId = "6a97383cec1273ecd6faca5b"
  const b = binding({
    id: `dewalt:${bareId}`,
    email: "hodavo5036@prorises.com",
    connectionKey: "dewalt",
    auth0UserId: bareId, // provider-LESS, as stored
    useCase: "per-brand-password",
    brand: "dewalt",
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: `dewalt:${bareId}` },
    bindings: [b],
    identities: [identity("dewalt", bareId)], // provider-LESS user_id
    configuredKeys: ALL_KEYS,
    rootEmail: "hodavo5036@prorises.com",
    // The DeWalt identity IS this account's primary/root database identity.
    rootUserId: `auth0|${bareId}`,
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "dewalt")
    assert.equal(res.target.email, "hodavo5036@prorises.com")
    // Ownership id stays provider-less (matches bindings/identities)…
    assert.equal(res.target.auth0UserId, bareId)
    // …the Management PATCH id is the provider-qualified ROOT (here == matched).
    assert.equal(res.target.managementUserId, `auth0|${bareId}`)
    assert.equal(res.target.isLinkedSecondary, false)
  }
})

test("Model 4 linked-SECONDARY (EXACT live Stanley shape): PATCHes the ROOT, not the secondary", () => {
  // Live defect: a Stanley credential linked into the primary was PATCHed at
  // its OWN id (auth0|6a97390e…) → 404 inexistent_user, because after linking
  // the secondary user is removed from the users list. Per Auth0 docs the PATCH
  // must target the PRIMARY/ROOT user with { connection } so Auth0 reaches the
  // Stanley database identity. So managementUserId MUST be the root, while the
  // provider-less auth0UserId still identifies WHICH database identity changes.
  const secId = "6a97390eec1273ecd6faca5e" // the Stanley secondary's own id
  const rootId = "auth0|6a97383cec1273ecd6faca5b" // the signed-in account root
  const b = binding({
    id: `stanley:${secId}`,
    email: "hodavo5036@prorises.com",
    connectionKey: "stanley",
    auth0UserId: secId, // provider-less
    useCase: "per-brand-password",
    brand: "stanley",
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: `stanley:${secId}` },
    bindings: [b],
    identities: [
      identity("shared", "6a97383cec1273ecd6faca5b"), // the primary identity
      identity("stanley", secId), // linked secondary brand identity
    ],
    configuredKeys: ALL_KEYS,
    rootEmail: "hodavo5036@prorises.com",
    rootUserId: rootId,
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "stanley")
    // ownership id = the secondary DB identity (provider-less)…
    assert.equal(res.target.auth0UserId, secId)
    assert.equal(res.target.isLinkedSecondary, true)
    // …but the Management PATCH id is the ROOT (NOT auth0|<secId>, which 404s).
    assert.equal(res.target.managementUserId, rootId)
    assert.notEqual(res.target.managementUserId, `auth0|${secId}`)
  }
})

test("Model 3 per-email (provider-less binding id): qualified managementUserId", () => {
  const secId = "peemail0000000000000abcd"
  const b = binding({
    id: `per-email:${secId}`,
    email: "alt@example.com",
    connectionKey: "per-email",
    auth0UserId: secId, // provider-less
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: `per-email:${secId}` },
    bindings: [b],
    identities: [identity("per-email", secId)],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    // Standalone per-email account: this identity IS the root.
    rootUserId: `auth0|${secId}`,
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.auth0UserId, secId)
    assert.equal(res.target.managementUserId, `auth0|${secId}`)
    assert.equal(res.target.isLinkedSecondary, false)
  }
})

test("Model 3 linked-SECONDARY per-email under a shared primary PATCHes the ROOT", () => {
  // Same live class as the Stanley case: the per-email credential is a linked
  // secondary, so its own id would 404. The PATCH must target the primary root
  // with { connection }; managementUserId is the root, not the secondary id.
  const secId = "peemailsecondary00000001"
  const rootId = "auth0|sharedprimary00000000009"
  const b = binding({
    id: `per-email:${secId}`,
    email: "second@example.com",
    connectionKey: "per-email",
    auth0UserId: secId,
  })
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: `per-email:${secId}` },
    bindings: [b],
    identities: [
      identity("shared", "sharedprimary00000000009"),
      identity("per-email", secId),
    ],
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: rootId,
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.auth0UserId, secId)
    assert.equal(res.target.isLinkedSecondary, true)
    assert.equal(res.target.managementUserId, rootId)
    assert.notEqual(res.target.managementUserId, `auth0|${secId}`)
  }
})

test("Model 1/2 shared with a provider-less identity qualifies the PATCH id", () => {
  const bareId = "sharedbare0000000000abcd"
  const res = resolvePasswordChangeTarget({
    selector: { scope: "shared" },
    bindings: [],
    identities: [identity("shared", bareId)], // provider-less
    configuredKeys: ALL_KEYS,
    rootEmail: "primary@example.com",
    rootUserId: `auth0|${bareId}`,
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.auth0UserId, bareId)
    assert.equal(res.target.managementUserId, `auth0|${bareId}`)
    assert.equal(res.target.isLinkedSecondary, false)
  }
})

// --- New-password policy + submit gating ------------------------------------

test("validateNewPassword enforces length + character classes", () => {
  assert.equal(validateNewPassword("short1A").ok, false) // 7 chars
  assert.equal(validateNewPassword("alllowercase1").ok, false) // no upper
  assert.equal(validateNewPassword("ALLUPPERCASE1").ok, false) // no lower
  assert.equal(validateNewPassword("NoNumbersHere").ok, false) // no digit
  assert.equal(validateNewPassword("GoodPass1").ok, true)
})

test("canSubmitPasswordChange gates on all four rules (mismatch, reuse, policy, presence)", () => {
  const base = { current: "OldPass1", next: "NewPass1", confirm: "NewPass1" }
  assert.equal(canSubmitPasswordChange(base), true)
  // missing current
  assert.equal(canSubmitPasswordChange({ ...base, current: "" }), false)
  // confirm mismatch
  assert.equal(
    canSubmitPasswordChange({ ...base, confirm: "Different1" }),
    false,
  )
  // new == current (no-op change)
  assert.equal(
    canSubmitPasswordChange({ current: "NewPass1", next: "NewPass1", confirm: "NewPass1" }),
    false,
  )
  // new fails policy
  assert.equal(
    canSubmitPasswordChange({ current: "OldPass1", next: "weak", confirm: "weak" }),
    false,
  )
})

// --- Auth0 error mapping -----------------------------------------------------

test("mapPasswordUpdateError surfaces a policy hint only for real policy failures", () => {
  assert.match(
    mapPasswordUpdateError({ status: 400, code: "PasswordStrengthError" }),
    /password policy|stronger/i,
  )
  assert.match(
    mapPasswordUpdateError({
      status: 400,
      message: "Password has previously been used",
    }),
    /stronger|policy/i,
  )
  // A non-policy failure stays generic (no upstream leak).
  const generic = mapPasswordUpdateError({ status: 500, message: "boom upstream" })
  assert.match(generic, /couldn't change your password/i)
  assert.doesNotMatch(generic, /boom upstream/i)
})
