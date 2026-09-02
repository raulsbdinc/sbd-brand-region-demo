// Unit tests for the PURE credential model (no framework, no network).
// Run with:  node --test lib/credential-model.test.ts
//
// Node 24 strips TypeScript types natively, and credential-model.ts has only a
// type-only relative import, so this runs with the built-in test runner exactly
// like auth0/actions/add-sbd-claims.test.js.

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  aggregateCandidateLookups,
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
  resolveCredentialFromCandidates,
  resolveEmailOwnership,
  resolveResetBinding,
  sanitizeCredentialBinding,
  sanitizeCredentialBindings,
  signinResolutionPermitsRealmOperation,
  summarizePasswordModel,
  summarizePasswordModelFromMethods,
  SHARED_CONNECTION_FALLBACK,
  type CandidateAccount,
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

test("resolve: a SAME-account shared login PLUS its own scoped credential RESOLVES to the scoped one (intentional override)", () => {
  // The same email is both a genuine shared login (root/alias, sharedMatch=true)
  // AND has a single backed scoped credential ON THE SAME ACCOUNT. This is the
  // customer intentionally giving this email its own password — the scoped
  // credential wins for its allowed scope (it is NOT a cross-account collision).
  // Cross-account collisions are covered by the section-13 ownership tests.
  const b = binding() // per-email, backed below
  const res = resolveCredential({
    email: b.email,
    siteBrand: "dewalt",
    bindings: [b],
    identities: [identity("per-email", b.auth0UserId), identity("shared", "auth0|root")],
    configuredKeys: ALL_KEYS,
    sharedMatch: true,
  })
  assert.deepEqual(res, { ok: true, kind: "resolved", connectionKey: "per-email", binding: b })
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

// --- 13. Account ownership: no cross-account binding/identity matching ------
// The email under test on all of these.
const OWN_EMAIL = "owner@example.com"

function candidate(
  accountId: string,
  bindings: CredentialBinding[],
  identities: LinkedDbIdentity[],
  sharedMatch = false,
): CandidateAccount {
  return { accountId, bindings, identities, sharedMatch }
}

test("ownership: a binding on account A is NOT backed by an identity that exists only on account B", () => {
  // Account A OWNS the per-email binding but has NO backing identity of its own.
  const accountA = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "per-email",
        auth0UserId: "auth0|per-email-1",
        useCase: "per-email-password",
      }),
    ],
    [identity("shared", "auth0|shared-a")], // only a shared identity, no per-email
  )
  // Account B HAS the matching per-email identity, but owns NO such binding.
  const accountB = candidate("auth0|B", [], [identity("per-email", "auth0|per-email-1")])

  const res = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    candidates: [accountA, accountB],
    configuredKeys: ALL_KEYS,
  })

  // The binding must NOT be validated by B's identity → no non-shared match →
  // shared-default (NOT "resolved").
  assert.equal(res.ok, true)
  assert.equal(res.ok && res.kind, "shared-default")
})

test("ownership: same flattened data WOULD have cross-matched — proving the per-account guard matters", () => {
  // Sanity check: if we (incorrectly) flattened A's binding with B's identity,
  // the single-account resolver resolves. This documents the exact bug the
  // per-account form prevents.
  const flattenedResolves = resolveCredential({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    bindings: [
      binding({
        email: OWN_EMAIL,
        connectionKey: "per-email",
        auth0UserId: "auth0|per-email-1",
        useCase: "per-email-password",
      }),
    ],
    identities: [identity("per-email", "auth0|per-email-1")],
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.equal(flattenedResolves.ok && flattenedResolves.kind, "resolved")
})

test("ownership: a binding backed by an identity on ITS OWN account resolves", () => {
  const account = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "dewalt",
        auth0UserId: "auth0|dw-1",
        useCase: "per-brand-password",
        brand: "dewalt",
      }),
    ],
    [identity("dewalt", "auth0|dw-1")],
  )
  const res = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok && res.kind, "resolved")
  assert.equal(res.ok && res.kind === "resolved" && res.connectionKey, "dewalt")
})

test("ownership: two DIFFERENT accounts each with a valid scoped credential remain AMBIGUOUS", () => {
  // Two DIFFERENT accounts, each with its OWN valid scoped credential for the
  // same email (a per-email account and a dewalt account). Each is
  // same-account-validated, but together they are a real collision → ambiguous.
  const perEmailAccount = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "per-email",
        auth0UserId: "auth0|pe-1",
        useCase: "per-email-password",
      }),
    ],
    [identity("per-email", "auth0|pe-1")],
  )
  const dewaltAccount = candidate(
    "auth0|B",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "dewalt",
        auth0UserId: "auth0|dw-1",
        useCase: "per-brand-password",
        brand: "dewalt",
      }),
    ],
    [identity("dewalt", "auth0|dw-1")],
  )
  const res = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    candidates: [perEmailAccount, dewaltAccount],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.reason, "ambiguous")
})

// --- 13a. SAME-account scoped override vs CROSS-account collision -----------
test("override: a scoped credential + shared match on the SAME account RESOLVES to the scoped credential", () => {
  // The normal Model 1/2 -> scoped transition: the customer gave THIS email its
  // own per-email password on their OWN account (which also has the shared
  // identity). The scoped credential must win — not fail closed.
  const account = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "per-email",
        auth0UserId: "auth0|pe-1",
        useCase: "per-email-password",
      }),
    ],
    [identity("shared", "auth0|shared-a"), identity("per-email", "auth0|pe-1")],
    true, // this same account is ALSO a genuine shared login for the email
  )
  const res = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok && res.kind, "resolved")
  assert.equal(res.ok && res.kind === "resolved" && res.connectionKey, "per-email")
})

test("override: a scoped credential on account A + shared match on a DIFFERENT account B is AMBIGUOUS", () => {
  // Account A intentionally owns a per-email credential. A SEPARATE person's
  // account B is a genuine shared login for the same email → real cross-account
  // collision → fail closed.
  const accountA = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "per-email",
        auth0UserId: "auth0|pe-1",
        useCase: "per-email-password",
      }),
    ],
    [identity("per-email", "auth0|pe-1")],
    false,
  )
  const accountB = candidate("auth0|B", [], [identity("shared", "auth0|shared-b")], true)
  const res = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    candidates: [accountA, accountB],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.reason, "ambiguous")
})

test("override: a brand credential wins ONLY on its own brand; the shared password keeps working elsewhere", () => {
  // Same account owns a dewalt brand credential and is a shared login. On a
  // dewalt site the brand credential wins; on a stanley site it is out of scope
  // so the account falls back to shared-default (shared password still works).
  const account = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "dewalt",
        auth0UserId: "auth0|dw-1",
        useCase: "per-brand-password",
        brand: "dewalt",
      }),
    ],
    [identity("shared", "auth0|shared-a"), identity("dewalt", "auth0|dw-1")],
    true,
  )
  const onDewalt = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(onDewalt.ok && onDewalt.kind === "resolved" && onDewalt.connectionKey, "dewalt")

  const onStanley = resolveCredentialFromCandidates({
    email: OWN_EMAIL,
    siteBrand: "stanley",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(onStanley.ok && onStanley.kind, "shared-default")
})

test("override: another verified email on the same account keeps using the shared password", () => {
  // The account gave OWN_EMAIL a per-email password, but a DIFFERENT verified
  // email on the same account has no scoped binding → shared-default.
  const account = candidate(
    "auth0|A",
    [
      binding({
        email: OWN_EMAIL,
        connectionKey: "per-email",
        auth0UserId: "auth0|pe-1",
        useCase: "per-email-password",
      }),
    ],
    [identity("shared", "auth0|shared-a"), identity("per-email", "auth0|pe-1")],
    true,
  )
  const res = resolveCredentialFromCandidates({
    email: "other@example.com",
    siteBrand: "dewalt",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok && res.kind, "shared-default")
})

test("ownership: no candidates at all → shared-default (unknown email)", () => {
  const res = resolveCredentialFromCandidates({
    email: "nobody@example.com",
    siteBrand: "dewalt",
    candidates: [],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok && res.kind, "shared-default")
})

test("ownership: resolveCredential delegates as a single candidate (same-account) — unchanged", () => {
  const res = resolveCredential({
    email: OWN_EMAIL,
    siteBrand: "dewalt",
    bindings: [
      binding({
        email: OWN_EMAIL,
        connectionKey: "dewalt",
        auth0UserId: "auth0|dw-1",
        useCase: "per-brand-password",
        brand: "dewalt",
      }),
    ],
    identities: [identity("dewalt", "auth0|dw-1")],
    configuredKeys: ALL_KEYS,
    sharedMatch: false,
  })
  assert.equal(res.ok && res.kind === "resolved" && res.connectionKey, "dewalt")
})

// --- 14. Sign-in realm decision helper (unavailable fails closed) -----------
test("decision: resolved and shared-default PERMIT a realm operation", () => {
  assert.equal(signinResolutionPermitsRealmOperation("resolved"), true)
  assert.equal(signinResolutionPermitsRealmOperation("shared-default"), true)
})

test("decision: ambiguous and unavailable FORBID any realm operation (no exchange/challenge/reset)", () => {
  assert.equal(signinResolutionPermitsRealmOperation("ambiguous"), false)
  assert.equal(signinResolutionPermitsRealmOperation("unavailable"), false)
})

// --- 15. Candidate-lookup aggregation (rejected search fails closed) --------
// This is the PURE aggregation the server resolver runs over its settled
// lookups. NOTE: these tests exercise the aggregation + decision LOGIC only —
// they do NOT invoke the route handlers, so they do not claim the password /
// passcode / recovery SIDE EFFECTS are unit-tested; those are enforced by the
// routes calling signinResolutionPermitsRealmOperation on this outcome.
type FakeUser = { user_id?: string }

const fulfilled = (v: FakeUser[]): PromiseSettledResult<FakeUser[]> => ({
  status: "fulfilled",
  value: v,
})
const rejected = (): PromiseSettledResult<FakeUser[]> => ({
  status: "rejected",
  reason: new Error("management search failed"),
})

// The resolver's own mapping from an aggregation result to whether a realm
// operation may run. Kept inline (pure) to prove the FULL chain: a rejected
// indexed search → ok:false → "unavailable" → NO realm operation.
function aggregationToDecisionKind(
  agg: { ok: boolean },
): "unavailable" | "proceed" {
  return agg.ok ? "proceed" : "unavailable"
}

test("aggregate: both lookups fulfilled → ok, deduped candidates by user_id", () => {
  const agg = aggregateCandidateLookups([
    fulfilled([{ user_id: "auth0|a" }, { user_id: "auth0|b" }]),
    fulfilled([{ user_id: "auth0|b" }, { user_id: "auth0|c" }]),
  ])
  assert.equal(agg.ok, true)
  assert.deepEqual(
    agg.candidates.map((u) => u.user_id),
    ["auth0|a", "auth0|b", "auth0|c"],
  )
})

test("aggregate: a REJECTED indexed search → ok:false (NOT treated as empty match)", () => {
  const agg = aggregateCandidateLookups([
    fulfilled([{ user_id: "auth0|a" }]), // root-email lookup succeeded
    rejected(), // indexed search FAILED
  ])
  assert.equal(agg.ok, false)
  // It still keeps whatever the successful lookup returned, but ok:false is what
  // forces the caller to fail closed regardless.
  assert.deepEqual(
    agg.candidates.map((u) => u.user_id),
    ["auth0|a"],
  )
})

test("aggregate: rejected indexed search maps to 'unavailable' → NO realm operation (not shared-default)", () => {
  const agg = aggregateCandidateLookups([fulfilled([]), rejected()])
  const kind = aggregationToDecisionKind(agg)
  assert.equal(kind, "unavailable")
  // The resolver returns { kind: "unavailable" } for this; the routes gate on
  // signinResolutionPermitsRealmOperation, which forbids any realm op here.
  assert.equal(signinResolutionPermitsRealmOperation("unavailable"), false)
})

test("aggregate: a REJECTED root-email lookup also → ok:false / unavailable", () => {
  const agg = aggregateCandidateLookups([rejected(), fulfilled([{ user_id: "auth0|x" }])])
  assert.equal(agg.ok, false)
  assert.equal(aggregationToDecisionKind(agg), "unavailable")
})

test("aggregate: both fulfilled but empty → ok:true → proceed (genuine no-match → shared-default upstream)", () => {
  const agg = aggregateCandidateLookups([fulfilled([]), fulfilled([])])
  assert.equal(agg.ok, true)
  assert.equal(aggregationToDecisionKind(agg), "proceed")
})

test("aggregate: records without a user_id are skipped", () => {
  const agg = aggregateCandidateLookups([
    fulfilled([{ user_id: "auth0|a" }, {}]),
    fulfilled([{ user_id: undefined }]),
  ])
  assert.equal(agg.ok, true)
  assert.deepEqual(
    agg.candidates.map((u) => u.user_id),
    ["auth0|a"],
  )
})

// --- resolveEmailOwnership: cold-Google reconcile ambiguity regression ------
// These lock in the fix for the live E2E defect after PR #48: a cold "Continue
// with Google" login where the fresh standalone google-oauth2 user's own root
// email IS the alias of exactly ONE real primary. Counting the transient source
// record as a target owner made one real owner look ambiguous
// (/auth-error?reason=link_ambiguous). Excluding the source by user_id must let
// the single real owner resolve, while TWO genuinely distinct owners still fail.

const PRIMARY = "auth0|lexavo-primary"
const GOOGLE_DUP = "google-oauth2|transient-dup"
const GMAIL = "raul.sbdinc@gmail.com"

test("ownership: EXACT callback condition — source Google dup excluded, one real alias owner → single(primary)", () => {
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [
      // The transient standalone Google user Auth0 just minted: its OWN root
      // email is the Gmail, so it "owns" the address in raw terms.
      { userId: GOOGLE_DUP, ownedEmails: [GMAIL] },
      // The real primary DB user that verified the Gmail as a login alias.
      { userId: PRIMARY, ownedEmails: ["lexavo4853@prorises.com", GMAIL] },
    ],
    excludeUserId: GOOGLE_DUP,
  })
  assert.deepEqual(r, { kind: "single", userId: PRIMARY })
})

test("ownership: WITHOUT excluding the source dup, the same facts look ambiguous (proves the exclusion is load-bearing)", () => {
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [
      { userId: GOOGLE_DUP, ownedEmails: [GMAIL] },
      { userId: PRIMARY, ownedEmails: ["lexavo4853@prorises.com", GMAIL] },
    ],
  })
  assert.equal(r.kind, "ambiguous")
})

test("ownership: TRUE ambiguity — two DISTINCT real owners remain ambiguous even after excluding the source", () => {
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [
      { userId: GOOGLE_DUP, ownedEmails: [GMAIL] },
      { userId: "auth0|owner-a", ownedEmails: ["a@prorises.com", GMAIL] },
      { userId: "auth0|owner-b", ownedEmails: ["b@prorises.com", GMAIL] },
    ],
    excludeUserId: GOOGLE_DUP,
  })
  assert.equal(r.kind, "ambiguous")
})

test("ownership: idempotent repeat — Google identity already linked INTO the primary → the primary is the sole owner, source id absent has no effect", () => {
  // On a repeat cold login after a successful link, the google-oauth2 sub no
  // longer exists as a standalone record; the primary carries the verified
  // Gmail. Excluding a now-absent source id must still resolve to the primary.
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [
      { userId: PRIMARY, ownedEmails: ["lexavo4853@prorises.com", GMAIL] },
    ],
    excludeUserId: GOOGLE_DUP,
  })
  assert.deepEqual(r, { kind: "single", userId: PRIMARY })
})

test("ownership: excluding the SOLE owner (the source is the only holder) → none (self / no real target to link onto)", () => {
  // A genuinely standalone Google account whose email belongs to no one else:
  // excluding itself leaves zero owners → no collision → reconcile proceeds.
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [{ userId: GOOGLE_DUP, ownedEmails: [GMAIL] }],
    excludeUserId: GOOGLE_DUP,
  })
  assert.deepEqual(r, { kind: "none" })
})

test("ownership: conflicting-Google guard — a DIFFERENT primary already owning the Gmail plus the source dup still resolves to that one primary (link decision/refusal is downstream)", () => {
  // resolveEmailOwnership only identifies the single target owner; whether that
  // primary already has a conflicting google identity is refused later by the
  // link core. Here we prove ownership still resolves to exactly the primary.
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [
      { userId: GOOGLE_DUP, ownedEmails: [GMAIL] },
      { userId: PRIMARY, ownedEmails: [GMAIL] },
    ],
    excludeUserId: GOOGLE_DUP,
  })
  assert.deepEqual(r, { kind: "single", userId: PRIMARY })
})

test("ownership: matching is normalized (case/whitespace) and empty/absent ids are ignored", () => {
  const r = resolveEmailOwnership({
    email: "  RAUL.SBDinc@Gmail.com ",
    candidates: [
      { userId: "", ownedEmails: [GMAIL] },
      { userId: GOOGLE_DUP, ownedEmails: [GMAIL] },
      { userId: PRIMARY, ownedEmails: [" Raul.SBDinc@GMAIL.com "] },
    ],
    excludeUserId: GOOGLE_DUP,
  })
  assert.deepEqual(r, { kind: "single", userId: PRIMARY })
})

test("ownership: excluding a non-owner user_id has no effect", () => {
  const r = resolveEmailOwnership({
    email: GMAIL,
    candidates: [{ userId: PRIMARY, ownedEmails: [GMAIL] }],
    excludeUserId: "auth0|someone-unrelated",
  })
  assert.deepEqual(r, { kind: "single", userId: PRIMARY })
})

// --- UK storefront sign-in: Model 3 & Model 4 through the IDENTICAL form -----
// The /sign-in/uk chooser ("how was your account set up?") was the regression.
// Both DeWalt UK and Stanley UK now use the same branded drawer, which posts to
// the single /api/signin/password route. That route derives the ONE connection
// to authenticate against purely from the submitted email + the deployment's
// SITE_BRAND via resolveSigninCredential → resolveCredentialFromCandidates (the
// exact pure primitive exercised below). No model / connection / realm is ever
// exposed to the customer. These lock in that both live cases resolve through
// the identical public path, with wrong-password isolation and fail-closed
// ambiguity.
const UK_M3_A = "raul.primary@prorises.com"
const UK_M3_B = "raul.secondary@prorises.com"
const UK_M4_EMAIL = "pro@sbdinc.com"

test("uk sign-in: Model 3 — two emails, ONE customer, each identifies its OWN per-email credential through the same form", () => {
  // Model 3: two DIFFERENT emails identify the same customer; each owns an
  // independent per-email password. Same submitted email + brand → per-email.
  const accountA = candidate(
    "auth0|uk-m3-a",
    [binding({ email: UK_M3_A, connectionKey: "per-email", auth0UserId: "auth0|m3-a", useCase: "per-email-password" })],
    [identity("per-email", "auth0|m3-a")],
  )
  const accountB = candidate(
    "auth0|uk-m3-b",
    [binding({ email: UK_M3_B, connectionKey: "per-email", auth0UserId: "auth0|m3-b", useCase: "per-email-password" })],
    [identity("per-email", "auth0|m3-b")],
  )

  // Email A on a DeWalt UK storefront → per-email (its own credential).
  const resA = resolveCredentialFromCandidates({
    email: UK_M3_A,
    siteBrand: "dewalt",
    candidates: [accountA],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(resA.ok && resA.kind === "resolved" && resA.connectionKey, "per-email")

  // Email B on a Stanley UK storefront → still per-email (brand does not matter
  // for per-email); a DIFFERENT independent credential. Proves each email owns
  // its own lifecycle through the identical form.
  const resB = resolveCredentialFromCandidates({
    email: UK_M3_B,
    siteBrand: "stanley",
    candidates: [accountB],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(resB.ok && resB.kind === "resolved" && resB.connectionKey, "per-email")
  assert.notEqual(
    resA.ok && resA.kind === "resolved" && resA.binding?.auth0UserId,
    resB.ok && resB.kind === "resolved" && resB.binding?.auth0UserId,
  )
})

test("uk sign-in: Model 4 — same email, ONE customer, DeWalt vs Stanley own INDEPENDENT brand credentials through the same form", () => {
  // Model 4: the SAME email identifies one customer, but each brand owns its own
  // password. The submitted email is identical; the deployment's SITE_BRAND is
  // the ONLY thing that steers the connection — no customer model choice.
  const account = candidate(
    "auth0|uk-m4",
    [
      binding({ email: UK_M4_EMAIL, connectionKey: "dewalt", auth0UserId: "auth0|m4-dw", useCase: "per-brand-password", brand: "dewalt" }),
      binding({ email: UK_M4_EMAIL, connectionKey: "stanley", auth0UserId: "auth0|m4-st", useCase: "per-brand-password", brand: "stanley" }),
    ],
    [identity("dewalt", "auth0|m4-dw"), identity("stanley", "auth0|m4-st")],
  )

  const onDewalt = resolveCredentialFromCandidates({
    email: UK_M4_EMAIL,
    siteBrand: "dewalt",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(onDewalt.ok && onDewalt.kind === "resolved" && onDewalt.connectionKey, "dewalt")

  const onStanley = resolveCredentialFromCandidates({
    email: UK_M4_EMAIL,
    siteBrand: "stanley",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(onStanley.ok && onStanley.kind === "resolved" && onStanley.connectionKey, "stanley")
})

test("uk sign-in: Model 4 wrong-password ISOLATION — the DeWalt attempt only ever targets the dewalt realm (Stanley password can't satisfy it)", () => {
  // The route attempts ONLY the resolved realm (see /api/signin/password: the
  // "resolved" branch does a single passwordRealmExchange on that connection,
  // with NO shared attempt and NO alias fallback). So on DeWalt UK the ONLY
  // credential consulted is the dewalt one — the Stanley brand password is never
  // tried, which is exactly what isolates the two brand lifecycles. We prove the
  // resolution the route acts on pins dewalt (never stanley/shared) here.
  const account = candidate(
    "auth0|uk-m4-iso",
    [
      binding({ email: UK_M4_EMAIL, connectionKey: "dewalt", auth0UserId: "auth0|iso-dw", useCase: "per-brand-password", brand: "dewalt" }),
      binding({ email: UK_M4_EMAIL, connectionKey: "stanley", auth0UserId: "auth0|iso-st", useCase: "per-brand-password", brand: "stanley" }),
    ],
    [identity("dewalt", "auth0|iso-dw"), identity("stanley", "auth0|iso-st")],
  )
  const res = resolveCredentialFromCandidates({
    email: UK_M4_EMAIL,
    siteBrand: "dewalt",
    candidates: [account],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok && res.kind, "resolved")
  assert.equal(res.ok && res.kind === "resolved" && res.connectionKey, "dewalt")
  // Explicitly NOT stanley and NOT shared — the wrong-brand password is out of
  // scope for this attempt, so it cannot authenticate.
  assert.notEqual(res.ok && res.kind === "resolved" && res.connectionKey, "stanley")
})

test("uk sign-in: ambiguous mapping FAILS CLOSED through the same form — two distinct owners of one email → no realm attempt", () => {
  // Two DIFFERENT accounts each own a valid scoped credential for the same
  // submitted email. The single form cannot safely pick one → ambiguous → the
  // route (signinResolutionPermitsRealmOperation === false) attempts NO realm
  // and returns the generic 401. Never asks the customer to disambiguate.
  const perEmailAccount = candidate(
    "auth0|amb-a",
    [binding({ email: UK_M4_EMAIL, connectionKey: "per-email", auth0UserId: "auth0|amb-pe", useCase: "per-email-password" })],
    [identity("per-email", "auth0|amb-pe")],
  )
  const dewaltAccount = candidate(
    "auth0|amb-b",
    [binding({ email: UK_M4_EMAIL, connectionKey: "dewalt", auth0UserId: "auth0|amb-dw", useCase: "per-brand-password", brand: "dewalt" })],
    [identity("dewalt", "auth0|amb-dw")],
  )
  const res = resolveCredentialFromCandidates({
    email: UK_M4_EMAIL,
    siteBrand: "dewalt",
    candidates: [perEmailAccount, dewaltAccount],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.reason, "ambiguous")
})

test("uk sign-in: an UNOWNED email FAILS CLOSED to shared-default (no fabricated scoped credential)", () => {
  // An email with no candidates at all resolves to shared-default — the branded
  // drawer's normal Models 1/2 path — never invents a per-email/brand credential.
  const res = resolveCredentialFromCandidates({
    email: "stranger@nowhere.example",
    siteBrand: "stanley",
    candidates: [],
    configuredKeys: ALL_KEYS,
  })
  assert.equal(res.ok && res.kind, "shared-default")
})

test("ownership: no candidates / empty email → none", () => {
  assert.deepEqual(resolveEmailOwnership({ email: GMAIL, candidates: [] }), {
    kind: "none",
  })
  assert.deepEqual(
    resolveEmailOwnership({ email: "", candidates: [{ userId: PRIMARY, ownedEmails: [GMAIL] }] }),
    { kind: "none" },
  )
})
