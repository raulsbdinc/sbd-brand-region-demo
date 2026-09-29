import { test } from "node:test"
import assert from "node:assert/strict"
import type { ConnectionKey, CredentialBinding } from "./credential-model.ts"
import type { BrandId, CountryId } from "./types"
import {
  ACCOUNT_MODEL_META,
  accountModelAdditionAllowed,
  accountModelForBindings,
  accountModelSelectionAvailable,
  bindingsMixModels,
  brandConnectionKey,
  crossBrandConfirmMessage,
  isAccountModel,
  parseAccountModel,
  validateSharedSignupRequest,
  planModel3Completion,
  planModel3Registration,
  planModel4CrossBrandLink,
  planModel4Registration,
  planPerEmailRegistrationGuard,
  type PerEmailExistingFacts,
  type RegistrationContext,
} from "./account-model.ts"

// --- fixtures ---------------------------------------------------------------

const ALL_CONNECTIONS: Record<ConnectionKey, string | undefined> = {
  shared: "sbd-eu",
  "per-email": "sbd-demo-per-email",
  dewalt: "sbd-demo-dewalt",
  stanley: "sbd-demo-stanley",
}

function ctx(over: Partial<RegistrationContext> = {}): RegistrationContext {
  return {
    market: "uk" as CountryId,
    siteBrand: "dewalt" as BrandId,
    connectionNames: { ...ALL_CONNECTIONS },
    ...over,
  }
}

function binding(
  connectionKey: ConnectionKey,
  email = "jane@example.com",
): CredentialBinding {
  return {
    id: `bind-${connectionKey}-${email}`,
    email,
    connectionKey,
    auth0UserId: `auth0|${connectionKey}`,
    useCase:
      connectionKey === "per-email"
        ? "per-email-password"
        : connectionKey === "shared"
          ? "shared-account"
          : "per-brand-password",
    ...(connectionKey === "dewalt" || connectionKey === "stanley"
      ? { brand: connectionKey as BrandId }
      : {}),
  }
}

// --- 1. model id parsing ----------------------------------------------------

test("isAccountModel / parseAccountModel accept only the two allow-listed ids", () => {
  assert.equal(isAccountModel("per-email"), true)
  assert.equal(isAccountModel("per-brand"), true)
  assert.equal(isAccountModel("shared"), false)
  assert.equal(isAccountModel("model-3"), false)
  assert.equal(isAccountModel(""), false)
  assert.equal(isAccountModel(null), false)
  assert.equal(isAccountModel(42), false)

  assert.equal(parseAccountModel("per-brand"), "per-brand")
  assert.equal(parseAccountModel("sbd-demo-dewalt"), null) // no raw connection names
  assert.equal(parseAccountModel(undefined), null)
})

test("ACCOUNT_MODEL_META maps each model to the right connection family", () => {
  assert.deepEqual(ACCOUNT_MODEL_META["per-email"].connectionKeys, ["per-email"])
  assert.deepEqual(ACCOUNT_MODEL_META["per-brand"].connectionKeys, ["dewalt", "stanley"])
  assert.equal(ACCOUNT_MODEL_META["per-email"].useCase, "per-email-password")
  assert.equal(ACCOUNT_MODEL_META["per-brand"].useCase, "per-brand-password")
})

test("validateSharedSignupRequest: plain EU signup body is accepted", () => {
  assert.equal(validateSharedSignupRequest({ email: "a@b.com", password: "x" }), null)
})

test("validateSharedSignupRequest: a browser-supplied connection is refused", () => {
  assert.equal(
    validateSharedSignupRequest({ email: "a@b.com", password: "x", connection: "sbd-demo-dewalt" }),
    "connection-not-allowed",
  )
})

test("validateSharedSignupRequest: a UK account-model id must use the dedicated endpoint", () => {
  assert.equal(
    validateSharedSignupRequest({ email: "a@b.com", password: "x", accountModel: "per-email" }),
    "wrong-endpoint",
  )
  assert.equal(
    validateSharedSignupRequest({ email: "a@b.com", password: "x", accountModel: "per-brand" }),
    "wrong-endpoint",
  )
  // An unknown/garbage accountModel is ignored (treated as a plain shared signup).
  assert.equal(
    validateSharedSignupRequest({ email: "a@b.com", password: "x", accountModel: "nonsense" }),
    null,
  )
})

// --- 2. market gating -------------------------------------------------------

test("account-model selection is offered only in the UK market", () => {
  assert.equal(accountModelSelectionAvailable("uk"), true)
  for (const m of ["fr", "de", "us", "ca", "au"] as CountryId[]) {
    assert.equal(accountModelSelectionAvailable(m), false)
  }
})

// --- cross-brand confirm copy: the missing-space regression -----------------

test("crossBrandConfirmMessage keeps a space between the brand and 'account' (both brands)", () => {
  // DeWalt storefront, email already owns Stanley.
  const onDeWalt = crossBrandConfirmMessage("DeWalt", "Stanley")
  assert.match(onDeWalt, /already has a Stanley account\./)
  assert.doesNotMatch(onDeWalt, /Stanleyaccount/)
  assert.match(onDeWalt, /add DeWalt —/)

  // Stanley storefront, email already owns DeWalt (the symmetric case).
  const onStanley = crossBrandConfirmMessage("Stanley", "DeWalt")
  assert.match(onStanley, /already has a DeWalt account\./)
  assert.doesNotMatch(onStanley, /DeWaltaccount/)
  assert.match(onStanley, /add Stanley —/)
})

// --- 3. coherence: never mix model 3 and model 4 ---------------------------

test("accountModelForBindings ignores shared and reports the scoped family", () => {
  assert.equal(accountModelForBindings([]), null)
  assert.equal(accountModelForBindings([binding("shared")]), null)
  assert.equal(accountModelForBindings([binding("per-email")]), "per-email")
  assert.equal(accountModelForBindings([binding("dewalt")]), "per-brand")
  assert.equal(
    accountModelForBindings([binding("shared"), binding("stanley")]),
    "per-brand",
  )
})

test("bindingsMixModels flags an incoherent per-email + brand mix", () => {
  assert.equal(bindingsMixModels([binding("per-email"), binding("dewalt")]), true)
  assert.equal(bindingsMixModels([binding("dewalt"), binding("stanley")]), false)
  assert.equal(bindingsMixModels([binding("per-email")]), false)
  assert.equal(bindingsMixModels([binding("shared"), binding("per-email")]), false)
})

test("accountModelAdditionAllowed keeps an account within one model family", () => {
  // Fresh account (shared/none) can take either model.
  assert.equal(accountModelAdditionAllowed("per-email", []), true)
  assert.equal(accountModelAdditionAllowed("per-brand", [binding("shared")]), true)
  // Committed to per-brand: another brand ok, per-email refused.
  assert.equal(accountModelAdditionAllowed("per-brand", [binding("dewalt")]), true)
  assert.equal(accountModelAdditionAllowed("per-email", [binding("dewalt")]), false)
  // Committed to per-email: per-brand refused.
  assert.equal(accountModelAdditionAllowed("per-brand", [binding("per-email")]), false)
  // Already-mixed set fails closed for anything.
  assert.equal(
    accountModelAdditionAllowed("per-brand", [binding("per-email"), binding("dewalt")]),
    false,
  )
})

// --- 4. Model 3 registration planning --------------------------------------

test("planModel3Registration: primary only → single identity, hasSecondary false", () => {
  const r = planModel3Registration({ primaryEmail: "Jane@Example.com" }, ctx())
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.connectionKey, "per-email")
    assert.equal(r.connectionName, "sbd-demo-per-email")
    assert.equal(r.hasSecondary, false)
    assert.deepEqual(r.identities, [{ email: "jane@example.com", role: "primary" }])
  }
})

test("planModel3Registration: primary + secondary → two identities", () => {
  const r = planModel3Registration(
    { primaryEmail: "jane@example.com", secondaryEmail: "jane.work@example.com" },
    ctx(),
  )
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.hasSecondary, true)
    assert.deepEqual(r.identities, [
      { email: "jane@example.com", role: "primary" },
      { email: "jane.work@example.com", role: "secondary" },
    ])
  }
})

test("planModel3Registration: blank/whitespace secondary is treated as skipped", () => {
  const r = planModel3Registration(
    { primaryEmail: "jane@example.com", secondaryEmail: "   " },
    ctx(),
  )
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.hasSecondary, false)
})

test("planModel3Registration: fails closed on bad input", () => {
  assert.deepEqual(planModel3Registration({ primaryEmail: "nope" }, ctx()), {
    ok: false,
    reason: "invalid-primary-email",
  })
  assert.deepEqual(
    planModel3Registration(
      { primaryEmail: "jane@example.com", secondaryEmail: "bad" },
      ctx(),
    ),
    { ok: false, reason: "invalid-secondary-email" },
  )
  assert.deepEqual(
    planModel3Registration(
      { primaryEmail: "jane@example.com", secondaryEmail: "JANE@example.com" },
      ctx(),
    ),
    { ok: false, reason: "duplicate-email" },
  )
  assert.deepEqual(
    planModel3Registration(
      { primaryEmail: "jane@example.com" },
      ctx({ connectionNames: { ...ALL_CONNECTIONS, "per-email": undefined } }),
    ),
    { ok: false, reason: "not-configured" },
  )
  assert.deepEqual(
    planModel3Registration({ primaryEmail: "jane@example.com" }, ctx({ market: "fr" })),
    { ok: false, reason: "market-unavailable" },
  )
})

// --- 5. Model 4 first-brand registration planning --------------------------

test("brandConnectionKey maps only real brand storefronts", () => {
  assert.equal(brandConnectionKey("dewalt"), "dewalt")
  assert.equal(brandConnectionKey("stanley"), "stanley")
  assert.equal(brandConnectionKey("craftsman"), null)
})

test("planModel4Registration: DeWalt and Stanley storefronts plan their own key", () => {
  const dw = planModel4Registration({ email: "jane@example.com" }, ctx({ siteBrand: "dewalt" }))
  assert.equal(dw.ok, true)
  if (dw.ok) {
    assert.equal(dw.connectionKey, "dewalt")
    assert.equal(dw.connectionName, "sbd-demo-dewalt")
    assert.equal(dw.brand, "dewalt")
  }
  const st = planModel4Registration({ email: "jane@example.com" }, ctx({ siteBrand: "stanley" }))
  assert.equal(st.ok, true)
  if (st.ok) assert.equal(st.connectionKey, "stanley")
})

test("planModel4Registration: fails closed on bad input", () => {
  assert.deepEqual(planModel4Registration({ email: "nope" }, ctx()), {
    ok: false,
    reason: "invalid-email",
  })
  assert.deepEqual(
    planModel4Registration({ email: "jane@example.com" }, ctx({ siteBrand: "craftsman" })),
    { ok: false, reason: "unsupported-brand" },
  )
  assert.deepEqual(
    planModel4Registration(
      { email: "jane@example.com" },
      ctx({ connectionNames: { ...ALL_CONNECTIONS, dewalt: undefined } }),
    ),
    { ok: false, reason: "not-configured" },
  )
  assert.deepEqual(
    planModel4Registration({ email: "jane@example.com" }, ctx({ market: "de" })),
    { ok: false, reason: "market-unavailable" },
  )
})

// --- 6. Model 4 cross-brand link planning ----------------------------------

function crossCtx(over: Partial<Parameters<typeof planModel4CrossBrandLink>[0]> = {}) {
  return {
    market: "uk" as CountryId,
    siteBrand: "stanley" as BrandId,
    email: "jane@example.com",
    existingAccount: {
      auth0UserId: "auth0|primary",
      bindings: [binding("dewalt")],
    },
    proofVerified: true,
    ownershipEmailVerified: true,
    connectionNames: { ...ALL_CONNECTIONS },
    ...over,
  }
}

test("planModel4CrossBrandLink: refuses to link onto an unverified existing email even with proof", () => {
  assert.deepEqual(planModel4CrossBrandLink(crossCtx({ ownershipEmailVerified: false })), {
    ok: false,
    reason: "email-unverified",
  })
})

test("planModel4CrossBrandLink: links the second brand under the existing primary", () => {
  const r = planModel4CrossBrandLink(crossCtx())
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.brand, "stanley")
    assert.equal(r.connectionKey, "stanley")
    assert.equal(r.connectionName, "sbd-demo-stanley")
    assert.equal(r.primaryUserId, "auth0|primary")
    assert.equal(r.email, "jane@example.com")
  }
})

test("planModel4CrossBrandLink: reverse order — DeWalt storefront links under an existing Stanley account", () => {
  const r = planModel4CrossBrandLink(
    crossCtx({
      siteBrand: "dewalt",
      existingAccount: { auth0UserId: "auth0|primary", bindings: [binding("stanley")] },
    }),
  )
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.brand, "dewalt")
    assert.equal(r.connectionKey, "dewalt")
    assert.equal(r.connectionName, "sbd-demo-dewalt")
    assert.equal(r.primaryUserId, "auth0|primary")
    assert.equal(r.email, "jane@example.com")
  }
})

test("planModel4CrossBrandLink: no single account resolved → no-existing-account", () => {
  assert.deepEqual(planModel4CrossBrandLink(crossCtx({ existingAccount: null })), {
    ok: false,
    reason: "no-existing-account",
  })
})

test("planModel4CrossBrandLink: unverified proof fails closed", () => {
  assert.deepEqual(planModel4CrossBrandLink(crossCtx({ proofVerified: false })), {
    ok: false,
    reason: "proof-required",
  })
})

test("planModel4CrossBrandLink: existing per-email account cannot gain a brand credential", () => {
  assert.deepEqual(
    planModel4CrossBrandLink(
      crossCtx({
        existingAccount: { auth0UserId: "auth0|primary", bindings: [binding("per-email")] },
      }),
    ),
    { ok: false, reason: "model-conflict" },
  )
})

test("planModel4CrossBrandLink: already-mixed existing set fails closed", () => {
  assert.deepEqual(
    planModel4CrossBrandLink(
      crossCtx({
        existingAccount: {
          auth0UserId: "auth0|primary",
          bindings: [binding("per-email"), binding("dewalt")],
        },
      }),
    ),
    { ok: false, reason: "model-conflict" },
  )
})

test("planModel4CrossBrandLink: this brand already has a credential → duplicate", () => {
  assert.deepEqual(
    planModel4CrossBrandLink(
      crossCtx({
        siteBrand: "dewalt",
        existingAccount: { auth0UserId: "auth0|primary", bindings: [binding("dewalt")] },
      }),
    ),
    { ok: false, reason: "duplicate-brand-credential" },
  )
})

test("planModel4CrossBrandLink: other guards (market, brand, config, email)", () => {
  assert.deepEqual(planModel4CrossBrandLink(crossCtx({ market: "fr" })), {
    ok: false,
    reason: "market-unavailable",
  })
  assert.deepEqual(planModel4CrossBrandLink(crossCtx({ siteBrand: "craftsman" })), {
    ok: false,
    reason: "unsupported-brand",
  })
  assert.deepEqual(
    planModel4CrossBrandLink(
      crossCtx({ connectionNames: { ...ALL_CONNECTIONS, stanley: undefined } }),
    ),
    { ok: false, reason: "not-configured" },
  )
  assert.deepEqual(planModel4CrossBrandLink(crossCtx({ email: "nope" })), {
    ok: false,
    reason: "invalid-email",
  })
})

// --- Model 3 completion (deferred second email) -----------------------------

function completionCtx(over: Record<string, unknown> = {}) {
  return {
    market: "uk" as CountryId,
    primaryUserId: "auth0|primary",
    existingBindings: [binding("per-email", "first@example.com")],
    email: "second@example.com",
    ownershipVerified: true,
    connectionNames: { ...ALL_CONNECTIONS },
    ...over,
  }
}

test("planModel3Completion: verified second email on a per-email account → plan", () => {
  assert.deepEqual(planModel3Completion(completionCtx()), {
    ok: true,
    connectionKey: "per-email",
    connectionName: "sbd-demo-per-email",
    useCase: "per-email-password",
    email: "second@example.com",
    primaryUserId: "auth0|primary",
  })
})

test("planModel3Completion: unproven ownership fails closed", () => {
  assert.deepEqual(planModel3Completion(completionCtx({ ownershipVerified: false })), {
    ok: false,
    reason: "ownership-required",
  })
})

test("planModel3Completion: refuses onto a per-brand account (model conflict)", () => {
  assert.deepEqual(
    planModel3Completion(completionCtx({ existingBindings: [binding("dewalt")] })),
    { ok: false, reason: "model-conflict" },
  )
})

test("planModel3Completion: refuses an already-mixed account", () => {
  assert.deepEqual(
    planModel3Completion(
      completionCtx({ existingBindings: [binding("per-email"), binding("dewalt")] }),
    ),
    { ok: false, reason: "model-conflict" },
  )
})

test("planModel3Completion: duplicate email credential is rejected", () => {
  assert.deepEqual(
    planModel3Completion(
      completionCtx({
        email: "First@Example.com", // case-insensitive match of an existing binding
        existingBindings: [binding("per-email", "first@example.com")],
      }),
    ),
    { ok: false, reason: "duplicate-email-credential" },
  )
})

test("planModel3Completion: market + email + config guards", () => {
  assert.deepEqual(planModel3Completion(completionCtx({ market: "fr" })), {
    ok: false,
    reason: "market-unavailable",
  })
  assert.deepEqual(planModel3Completion(completionCtx({ email: "nope" })), {
    ok: false,
    reason: "invalid-email",
  })
  assert.deepEqual(
    planModel3Completion(
      completionCtx({ connectionNames: { ...ALL_CONNECTIONS, "per-email": undefined } }),
    ),
    { ok: false, reason: "not-configured" },
  )
})

// --- per-email registration guard: one email must never become two people ---
//
// The live regression: an email that already owns a UK brand (e.g. a Stanley
// brand credential created on the Stanley storefront) later runs the DeWalt UK
// per-email signup. The per-email create route must NOT mint a second Auth0
// user for that email — it must divert into the cross-brand proof flow so the
// email gains a DeWalt brand password on its EXISTING account.

function existingSingle(
  bindings: PerEmailExistingFacts extends { kind: "single" } ? never : CredentialBinding[],
  sameMailboxVerified = true,
): PerEmailExistingFacts {
  return { kind: "single", bindings, sameMailboxVerified }
}

test("per-email guard: email already owns the OTHER UK brand → divert, never a second user", () => {
  // A Stanley brand credential exists; the DeWalt UK storefront runs per-email.
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("stanley")]),
    thisBrandKey: "dewalt",
  })
  assert.equal(decision.kind, "divert-cross-brand")
  if (decision.kind === "divert-cross-brand") {
    // Same mailbox is verified → both proof options are offered.
    assert.deepEqual(decision.proofOptions, ["password", "email-code"])
  }
})

test("per-email guard: reverse — DeWalt owner on the Stanley storefront also diverts", () => {
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("dewalt")], false),
    thisBrandKey: "stanley",
  })
  assert.equal(decision.kind, "divert-cross-brand")
  if (decision.kind === "divert-cross-brand") {
    // Mailbox not verified for a code → password proof only.
    assert.deepEqual(decision.proofOptions, ["password"])
  }
})

test("per-email guard: THIS brand already owned → already-registered (no divert, no mint)", () => {
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("dewalt")]),
    thisBrandKey: "dewalt",
  })
  assert.deepEqual(decision, { kind: "already-registered" })
})

test("per-email guard: an existing per-email account for the email is not re-minted", () => {
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("per-email")]),
    thisBrandKey: "dewalt",
  })
  assert.deepEqual(decision, { kind: "already-registered" })
})

test("per-email guard: a shared (EU) account owning the email fails closed, never mints", () => {
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("shared")]),
    thisBrandKey: "dewalt",
  })
  assert.deepEqual(decision, { kind: "fail-closed" })
})

test("per-email guard: an already-mixed existing set fails closed", () => {
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("per-email"), binding("stanley")]),
    thisBrandKey: "dewalt",
  })
  assert.deepEqual(decision, { kind: "fail-closed" })
})

test("per-email guard: no owner → proceed; ambiguous/unavailable → fail closed; off → not-configured", () => {
  assert.deepEqual(
    planPerEmailRegistrationGuard({ existing: { kind: "none" }, thisBrandKey: "dewalt" }),
    { kind: "proceed" },
  )
  assert.deepEqual(
    planPerEmailRegistrationGuard({ existing: { kind: "ambiguous" }, thisBrandKey: "dewalt" }),
    { kind: "fail-closed" },
  )
  assert.deepEqual(
    planPerEmailRegistrationGuard({ existing: { kind: "unavailable" }, thisBrandKey: "dewalt" }),
    { kind: "fail-closed" },
  )
  assert.deepEqual(
    planPerEmailRegistrationGuard({ existing: { kind: "configured-off" }, thisBrandKey: "dewalt" }),
    { kind: "not-configured" },
  )
})

test("per-email guard: a brand owner on a non-brand storefront cannot divert → fail closed", () => {
  const decision = planPerEmailRegistrationGuard({
    existing: existingSingle([binding("stanley")]),
    thisBrandKey: null,
  })
  assert.deepEqual(decision, { kind: "fail-closed" })
})
