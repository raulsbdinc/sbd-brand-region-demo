// Unit tests for the PURE credential model (no framework, no network).
// Run with:  node --test lib/credential-model.test.ts
//
// Node 24 strips TypeScript types natively, and credential-model.ts has only a
// type-only relative import, so this runs with the built-in test runner exactly
// like auth0/actions/add-sbd-claims.test.js.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CONNECTION_KEY_META,
  configuredConnectionKeys,
  connectionKeyForName,
  hasSharedPasswordCredential,
  isBrandAllowed,
  isConnectionKey,
  normalizeEmail,
  resolveConnectionIds,
  resolveConnectionNames,
  resolveCredential,
  resolveResetBinding,
  sanitizeCredentialBinding,
  sanitizeCredentialBindings,
  summarizePasswordModel,
  summarizePasswordModelFromMethods,
  SHARED_CONNECTION_FALLBACK,
  type ConnectionKey,
  type CredentialBinding,
  type LinkedDbIdentity,
} from "./credential-model.ts"

// A fully-configured connection name map for resolver tests.
const NAMES: Record<ConnectionKey, string | undefined> = {
  shared: "sbd-eu",
  "per-email": "sbd-per-email",
  dewalt: "sbd-dewalt",
  stanley: "sbd-stanley",
}
const ALL_KEYS = configuredConnectionKeys(NAMES)

function binding(overrides: Partial<CredentialBinding> = {}): CredentialBinding {
  return {
    id: "b1",
    email: "user@example.com",
    connectionKey: "per-email",
    auth0UserId: "auth0|per-email-1",
    useCase: "per-email-password",
    ...overrides,
  }
}

function identity(
  connectionKey: ConnectionKey | null,
  userId: string,
): LinkedDbIdentity {
  return { connectionKey, userId }
}

// --- 1. Connection allowlisting --------------------------------------------
test("allowlist: only the four keys are connection keys", () => {
  for (const k of ["shared", "per-email", "dewalt", "stanley"]) {
    assert.equal(isConnectionKey(k), true)
  }
  for (const k of ["", "sbd-eu", "email", "google-oauth2", null, undefined, 3]) {
    assert.equal(isConnectionKey(k as unknown), false)
  }
})

test("allowlist: a binding with a non-allowlisted connection key is dropped", () => {
  const raw = {
    id: "x",
    email: "user@example.com",
    connectionKey: "sbd-eu", // raw NAME, not an allow-listed key
    auth0UserId: "auth0|1",
    useCase: "per-email-password",
  }
  assert.equal(sanitizeCredentialBinding(raw), null)
})

test("allowlist: sanitize normalizes email and dedupes bindings", () => {
  const bindings = sanitizeCredentialBindings([
    binding({ email: "  User@Example.COM " }),
    binding(), // duplicate connection+user
    binding({ connectionKey: "dewalt", auth0UserId: "auth0|d", useCase: "per-brand-password" }),
    { garbage: true },
  ])
  assert.equal(bindings.length, 2)
  assert.equal(bindings[0].email, "user@example.com")
})

// --- 2. Env resolution + fallback chain ------------------------------------
test("env: shared falls back through the documented chain to sbd-eu", () => {
  assert.equal(resolveConnectionNames({}).shared, SHARED_CONNECTION_FALLBACK)
  assert.equal(
    resolveConnectionNames({ NEXT_PUBLIC_AUTH0_CONNECTION: "compat" }).shared,
    "compat",
  )
  assert.equal(
    resolveConnectionNames({
      AUTH0_CONNECTION: "mid",
      NEXT_PUBLIC_AUTH0_CONNECTION: "compat",
    }).shared,
    "mid",
  )
  assert.equal(
    resolveConnectionNames({
      AUTH0_SHARED_CONNECTION: "primary",
      AUTH0_CONNECTION: "mid",
      NEXT_PUBLIC_AUTH0_CONNECTION: "compat",
    }).shared,
    "primary",
  )
})

test("env: per-key names and ids resolve independently with no fallback", () => {
  const names = resolveConnectionNames({
    AUTH0_PER_EMAIL_CONNECTION: "pe",
    AUTH0_DEWALT_CONNECTION: "dw",
    AUTH0_STANLEY_CONNECTION: "st",
  })
  assert.equal(names["per-email"], "pe")
  assert.equal(names.dewalt, "dw")
  assert.equal(names.stanley, "st")

  const ids = resolveConnectionIds({ AUTH0_DEWALT_CONNECTION_ID: "con_dw" })
  assert.equal(ids.dewalt, "con_dw")
  assert.equal(ids["per-email"], undefined)
})

test("env: configuredConnectionKeys reflects which names are present", () => {
  const keys = configuredConnectionKeys({
    shared: "sbd-eu",
    "per-email": undefined,
    dewalt: "dw",
    stanley: undefined,
  })
  assert.equal(keys.has("shared"), true)
  assert.equal(keys.has("dewalt"), true)
  assert.equal(keys.has("per-email"), false)
  assert.equal(keys.has("stanley"), false)
})

test("env: connectionKeyForName reverse-maps, preferring specific keys", () => {
  assert.equal(connectionKeyForName("sbd-dewalt", NAMES), "dewalt")
  assert.equal(connectionKeyForName("sbd-eu", NAMES), "shared")
  assert.equal(connectionKeyForName("unknown-conn", NAMES), null)
  assert.equal(connectionKeyForName(null, NAMES), null)
})

// --- 3. Site-brand restrictions --------------------------------------------
test("brand: per-brand keys are restricted to their brand; shared/per-email are universal", () => {
  assert.equal(isBrandAllowed("dewalt", "dewalt"), true)
  assert.equal(isBrandAllowed("dewalt", "stanley"), false)
  assert.equal(isBrandAllowed("stanley", "stanley"), true)
  assert.equal(isBrandAllowed("stanley", "dewalt"), false)
  assert.equal(isBrandAllowed("shared", "dewalt"), true)
  assert.equal(isBrandAllowed("per-email", "stanley"), true)
})

test("resolve: a DeWalt credential does NOT route on a Stanley storefront", () => {
  const b = binding({
    connectionKey: "dewalt",
    auth0UserId: "auth0|dw",
    useCase: "per-brand-password",
    brand: "dewalt",
  })
  const identities = [identity("dewalt", "auth0|dw")]

  // On DeWalt storefront → routes to dewalt.
  const onDewalt = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities,
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(onDewalt, { ok: true, kind: "resolved", connectionKey: "dewalt", binding: b })

  // On Stanley storefront → brand-restricted, so it falls back to shared.
  const onStanley = resolveCredential({
    email: b.email,
    siteBrand: "stanley",
    bindings: [b],
    identities,
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(onStanley, {
    ok: true,
    kind: "shared-default",
    connectionKey: "shared",
    binding: null,
  })
})

// --- 4. Unique + ambiguous resolution --------------------------------------
test("resolve: a unique backed per-email binding routes to per-email", () => {
  const b = binding()
  const res = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities: [identity("per-email", b.auth0UserId)],
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(res, { ok: true, kind: "resolved", connectionKey: "per-email", binding: b })
})

test("resolve: two distinct backed credentials for one email are AMBIGUOUS (fail closed)", () => {
  const a = binding({ id: "a", connectionKey: "per-email", auth0UserId: "auth0|pe" })
  const b = binding({
    id: "b",
    connectionKey: "dewalt",
    auth0UserId: "auth0|dw",
    useCase: "per-brand-password",
    brand: "dewalt",
  })
  const res = resolveCredential({
    email: a.email,
    siteBrand: "dewalt",
    bindings: [a, b],
    identities: [identity("per-email", "auth0|pe"), identity("dewalt", "auth0|dw")],
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(res, { ok: false, reason: "ambiguous" })
})

test("resolve: a real SHARED login PLUS a non-shared match is AMBIGUOUS (no realm)", () => {
  // The same email is both a genuine shared login (root/alias, sharedMatch=true)
  // AND has a single backed non-shared credential. We must NOT prefer either
  // realm — fail closed.
  const b = binding() // per-email, backed below
  const res = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities: [identity("per-email", b.auth0UserId), identity("shared", "auth0|root")],
    configuredKeys: ALL_KEYS,
    sharedMatch: true,
  })
  assert.deepEqual(res, { ok: false, reason: "ambiguous" })
})

test("resolve: the SAME unique credential resolves when there is NO shared collision", () => {
  // Identical to the collision test but sharedMatch=false → resolves cleanly.
  const b = binding()
  const res = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities: [identity("per-email", b.auth0UserId)],
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(res, { ok: true, kind: "resolved", connectionKey: "per-email", binding: b })
})

// --- 5. Shared alias compatibility -----------------------------------------
test("resolve: a root user with no bindings resolves to shared-default (cases 1 & 2)", () => {
  const res = resolveCredential({
    email: "root@example.com",
    siteBrand: "dewalt",
    bindings: [],
    identities: [identity("shared", "auth0|root")],
    configuredKeys: ALL_KEYS,
    sharedMatch: true,
  })
  assert.deepEqual(res, {
    ok: true,
    kind: "shared-default",
    connectionKey: "shared",
    binding: null,
  })
})

test("resolve: an unknown email still yields a neutral shared-default attempt", () => {
  const res = resolveCredential({
    email: "nobody@example.com",
    siteBrand: "dewalt",
    bindings: [],
    identities: [],
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(res, {
    ok: true,
    kind: "shared-default",
    connectionKey: "shared",
    binding: null,
  })
})

test("resolve: shared bindings never override the default shared path", () => {
  const shared = binding({
    connectionKey: "shared",
    useCase: "shared-account",
    auth0UserId: "auth0|root",
  })
  const res = resolveCredential({
    email: shared.email,
    siteBrand: "stanley",
    bindings: [shared],
    identities: [identity("shared", "auth0|root")],
    configuredKeys: ALL_KEYS,
    sharedMatch: true,
  })
  assert.deepEqual(res, {
    ok: true,
    kind: "shared-default",
    connectionKey: "shared",
    binding: null,
  })
})

// --- 6. Metadata validated against real identities -------------------------
test("resolve: a binding NOT backed by a linked identity is ignored (falls back to shared)", () => {
  const b = binding() // per-email, but no matching identity below
  const res = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities: [identity("shared", "auth0|root")], // no per-email identity
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.deepEqual(res, {
    ok: true,
    kind: "shared-default",
    connectionKey: "shared",
    binding: null,
  })
})

test("resolve: a binding on an UNCONFIGURED connection is ignored", () => {
  const b = binding({ connectionKey: "dewalt", auth0UserId: "auth0|dw", useCase: "per-brand-password", brand: "dewalt" })
  const configured = configuredConnectionKeys({ ...NAMES, dewalt: undefined })
  const res = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities: [identity("dewalt", "auth0|dw")],
    configuredKeys: configured,
    sharedMatch: false,
  })
  assert.deepEqual(res, {
    ok: true,
    kind: "shared-default",
    connectionKey: "shared",
    binding: null,
  })
})

test("resolve: fails closed with not-configured when shared has no connection", () => {
  const res = resolveCredential({
    email: "x@example.com",
    siteBrand: "dewalt",
    bindings: [],
    identities: [],
    configuredKeys: new Set<ConnectionKey>(),
    sharedMatch: false,
  })
  assert.deepEqual(res, { ok: false, reason: "not-configured" })
})

// --- 7. Reset-binding validation -------------------------------------------
test("reset: a valid backed binding id resolves", () => {
  const b = binding({ id: "reset-1" })
  const res = resolveResetBinding({
    bindingId: "reset-1",
    bindings: [b],
    identities: [identity("per-email", b.auth0UserId)],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.binding.id, "reset-1")
})

test("reset: an unknown id is not-found", () => {
  const res = resolveResetBinding({
    bindingId: "nope",
    bindings: [binding({ id: "reset-1" })],
    identities: [identity("per-email", "auth0|per-email-1")],
    configuredKeys: ALL_KEYS,
  })
  assert.deepEqual(res, { ok: false, reason: "not-found" })
})

test("reset: an empty id is not-found", () => {
  const res = resolveResetBinding({
    bindingId: "   ",
    bindings: [binding({ id: "reset-1" })],
    identities: [identity("per-email", "auth0|per-email-1")],
    configuredKeys: ALL_KEYS,
  })
  assert.deepEqual(res, { ok: false, reason: "not-found" })
})

test("reset: a binding not backed by a linked identity is unbacked", () => {
  const b = binding({ id: "reset-1" })
  const res = resolveResetBinding({
    bindingId: "reset-1",
    bindings: [b],
    identities: [identity("shared", "auth0|root")],
    configuredKeys: ALL_KEYS,
  })
  assert.deepEqual(res, { ok: false, reason: "unbacked" })
})

test("reset: a binding on an unconfigured connection is not-configured", () => {
  const b = binding({ id: "reset-1" })
  const res = resolveResetBinding({
    bindingId: "reset-1",
    bindings: [b],
    identities: [identity("per-email", b.auth0UserId)],
    configuredKeys: configuredConnectionKeys({ ...NAMES, "per-email": undefined }),
  })
  assert.deepEqual(res, { ok: false, reason: "not-configured" })
})

// --- 8. Binding metadata COHERENCE -----------------------------------------
test("coherence: shared accepts only shared-account / linked-identities and no brand", () => {
  assert.ok(sanitizeCredentialBinding(binding({ connectionKey: "shared", useCase: "shared-account" })))
  assert.ok(sanitizeCredentialBinding(binding({ connectionKey: "shared", useCase: "linked-identities" })))
  // Wrong use case for shared → rejected.
  assert.equal(
    sanitizeCredentialBinding(binding({ connectionKey: "shared", useCase: "per-email-password" })),
    null,
  )
  // Shared carrying a brand is incoherent → rejected (not normalized).
  assert.equal(
    sanitizeCredentialBinding(binding({ connectionKey: "shared", useCase: "shared-account", brand: "dewalt" })),
    null,
  )
})

test("coherence: per-email accepts only per-email-password and no brand", () => {
  assert.ok(sanitizeCredentialBinding(binding()))
  assert.equal(
    sanitizeCredentialBinding(binding({ useCase: "shared-account" })),
    null,
  )
  assert.equal(
    sanitizeCredentialBinding(binding({ brand: "dewalt" })),
    null,
  )
})

test("coherence: per-brand keys require per-brand-password and the MATCHING brand", () => {
  const dw = sanitizeCredentialBinding(
    binding({ connectionKey: "dewalt", auth0UserId: "auth0|dw", useCase: "per-brand-password", brand: "dewalt" }),
  )
  assert.equal(dw?.brand, "dewalt")

  // Brand absent → derived from the key (coherent, key IS the brand).
  const derived = sanitizeCredentialBinding(
    binding({ connectionKey: "stanley", auth0UserId: "auth0|st", useCase: "per-brand-password" }),
  )
  assert.equal(derived?.brand, "stanley")

  // Mismatched brand → rejected (dewalt key with stanley brand).
  assert.equal(
    sanitizeCredentialBinding(
      binding({ connectionKey: "dewalt", auth0UserId: "auth0|dw", useCase: "per-brand-password", brand: "stanley" }),
    ),
    null,
  )

  // Wrong use case for a per-brand key → rejected.
  assert.equal(
    sanitizeCredentialBinding(
      binding({ connectionKey: "dewalt", auth0UserId: "auth0|dw", useCase: "per-email-password" }),
    ),
    null,
  )
})

test("coherence: a present but unknown brand string is malformed → rejected", () => {
  assert.equal(
    sanitizeCredentialBinding(
      binding({ connectionKey: "dewalt", auth0UserId: "auth0|dw", useCase: "per-brand-password", brand: "acme" as never }),
    ),
    null,
  )
})

// --- 9. Password-model summary (from bindings) -----------------------------
test("summary: no bindings → single shared password", () => {
  const s = summarizePasswordModel([])
  assert.equal(s.singleSharedPassword, true)
  assert.equal(s.perBrand, false)
  assert.equal(s.perEmail, false)
})

test("summary: per-brand bindings report brands and drop the one-password claim", () => {
  const s = summarizePasswordModel([
    binding({ connectionKey: "dewalt", useCase: "per-brand-password", brand: "dewalt" }),
    binding({ connectionKey: "stanley", useCase: "per-brand-password", brand: "stanley", auth0UserId: "auth0|st" }),
  ])
  assert.equal(s.singleSharedPassword, false)
  assert.equal(s.perBrand, true)
  assert.deepEqual(s.brands.sort(), ["dewalt", "stanley"])
})

test("summary: per-email binding drops the one-password claim", () => {
  const s = summarizePasswordModel([binding()])
  assert.equal(s.singleSharedPassword, false)
  assert.equal(s.perEmail, true)
})

// --- 10. Password-model summary (from login METHODS — the client data source)
test("topology: methods with only a shared password → single shared password", () => {
  const s = summarizePasswordModelFromMethods([
    { kind: "password", connectionKey: "shared" },
    { kind: "social" }, // ignored — not a password
    { kind: "passkey" }, // ignored
  ])
  assert.equal(s.singleSharedPassword, true)
  assert.equal(s.perBrand, false)
  assert.equal(s.perEmail, false)
})

test("topology: an untagged password method still reads as shared (no leak)", () => {
  const s = summarizePasswordModelFromMethods([{ kind: "password" }])
  assert.equal(s.singleSharedPassword, true)
})

test("topology: per-brand + per-email password methods surface the real topology", () => {
  const s = summarizePasswordModelFromMethods([
    { kind: "password", connectionKey: "shared" },
    { kind: "password", connectionKey: "dewalt", brand: "dewalt" },
    { kind: "password", connectionKey: "per-email" },
  ])
  assert.equal(s.singleSharedPassword, false)
  assert.equal(s.perBrand, true)
  assert.equal(s.perEmail, true)
  assert.deepEqual(s.brands, ["dewalt"])
})

test("topology: an empty methods list defaults to single shared password", () => {
  assert.equal(summarizePasswordModelFromMethods([]).singleSharedPassword, true)
})

// --- 11. Shared-reset visibility predicate ---------------------------------
test("shared-reset: shown when a shared (or untagged) password credential exists", () => {
  assert.equal(hasSharedPasswordCredential([{ kind: "password", connectionKey: "shared" }]), true)
  assert.equal(hasSharedPasswordCredential([{ kind: "password" }]), true)
  assert.equal(hasSharedPasswordCredential([{ kind: "password", connectionKey: null }]), true)
})

test("shared-reset: HIDDEN for a case-3/4-only account (no shared password)", () => {
  assert.equal(
    hasSharedPasswordCredential([
      { kind: "password", connectionKey: "dewalt", brand: "dewalt" },
      { kind: "password", connectionKey: "per-email" },
      { kind: "passkey" },
    ]),
    false,
  )
})

test("shared-reset: HIDDEN when there is no password credential at all", () => {
  assert.equal(hasSharedPasswordCredential([{ kind: "social" }, { kind: "passkey" }]), false)
})

// --- 12. Metadata sanity ----------------------------------------------------
test("meta: every connection key has metadata and brand keys carry a brand", () => {
  assert.equal(CONNECTION_KEY_META.dewalt.brand, "dewalt")
  assert.equal(CONNECTION_KEY_META.stanley.brand, "stanley")
  assert.equal(CONNECTION_KEY_META.shared.allowedBrands, null)
  assert.equal(CONNECTION_KEY_META["per-email"].allowedBrands, null)
  assert.deepEqual(CONNECTION_KEY_META.dewalt.allowedBrands, ["dewalt"])
})

test("normalizeEmail lowercases and trims, tolerating non-strings", () => {
  assert.equal(normalizeEmail("  A@B.com "), "a@b.com")
  assert.equal(normalizeEmail(123 as unknown), "")
})
