import { test } from "node:test"
import assert from "node:assert/strict"
import {
  canSubmitPasswordChange,
  mapPasswordUpdateError,
  resolvePasswordChangeTarget,
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
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "shared")
    assert.equal(res.target.auth0UserId, "auth0|primary")
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
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "per-email")
    assert.equal(res.target.email, "alt@example.com")
    assert.equal(res.target.auth0UserId, "auth0|pe")
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
  })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.target.connectionKey, "dewalt")
    assert.equal(res.target.brand, "dewalt")
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
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.reason, "invalid-selector")
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
