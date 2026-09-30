// ACCOUNT MODEL SELECTION — PURE, UK REGISTRATION
// ===============================================
// UK deployments (SITE_MARKET === "uk") let a registrant choose ONE account
// model at sign-up, and this module is the FRAMEWORK-FREE brain for that choice:
//
//   • "per-email" = Model 3: a different email AND a different password per
//     email, every identity created on the per-email connection and linked to
//     ONE primary Auth0 profile.
//   • "per-brand" = Model 4: the SAME email with a DIFFERENT password per brand
//     (DeWalt vs Stanley), each identity created on that brand's connection.
//
// It validates the submitted model id, plans the Auth0 identities/links/bindings
// a model needs, and — critically — enforces that a single logical account never
// MIXES model 3 and model 4 credentials. Like credential-provisioning.ts it has
// NO "server-only" import so every rule is unit-testable without Auth0.
//
// The browser may only ever submit an allow-listed MODEL ID plus emails and
// passwords. It NEVER submits a connection name/id, user id, use case, or brand.
// Those are resolved HERE (model → connection family) or by the calling endpoint
// from SITE_BRAND / server-proven account state — never from the request. Every
// rule fails CLOSED with a neutral reason.

import {
  isBrandAllowed,
  normalizeEmail,
  type ConnectionKey,
  type CredentialBinding,
  type DemoUseCase,
} from "./credential-model.ts"
import type { BrandId, CountryId } from "./types"
import {
  LEGACY_PER_EMAIL_ACCOUNT_MESSAGE,
  UK_PER_EMAIL_ACCOUNTS_FLAG,
} from "./uk-feature-flags.ts"

// --- The selectable models --------------------------------------------------

/** The two account models a UK registrant may choose between. */
export type AccountModel = "per-email" | "per-brand"

const ACCOUNT_MODELS: ReadonlySet<AccountModel> = new Set<AccountModel>([
  "per-email",
  "per-brand",
])

/** Whether a value is an allow-listed account model id. */
export function isAccountModel(value: unknown): value is AccountModel {
  return typeof value === "string" && ACCOUNT_MODELS.has(value as AccountModel)
}

/** Parse a submitted model id, returning null for anything not allow-listed. */
export function parseAccountModel(value: unknown): AccountModel | null {
  return isAccountModel(value) ? value : null
}

export type SharedSignupRejectReason = "connection-not-allowed" | "wrong-endpoint"

/**
 * Guard for the shared (EU Model 1/2) signup route. Enforces two invariants on
 * the raw request body before it can create a shared-connection user:
 *
 *   1. The browser may NEVER name an Auth0 connection — the shared route always
 *      resolves the connection server-side. Any `connection` field is refused.
 *   2. A UK account-model id (`per-email` / `per-brand`) must go through the
 *      dedicated registration endpoints, never this shared route — so a client
 *      can't smuggle a Model-3/4 signup onto the shared connection.
 *
 * Returns null when the body is acceptable for the shared route.
 */
export function validateSharedSignupRequest(
  body: Record<string, unknown>,
): SharedSignupRejectReason | null {
  if ("connection" in body && body.connection != null && body.connection !== "") {
    return "connection-not-allowed"
  }
  if (parseAccountModel(body.accountModel) !== null) {
    return "wrong-endpoint"
  }
  return null
}

export interface AccountModelMeta {
  model: AccountModel
  /** The demo use case this model embodies. */
  useCase: DemoUseCase
  /** Customer-facing choice title. */
  title: string
  /** Customer-facing one-line description. */
  description: string
  /** The connection keys this model's credentials may live on. */
  connectionKeys: ConnectionKey[]
}

export const ACCOUNT_MODEL_META: Record<AccountModel, AccountModelMeta> = {
  "per-email": {
    model: "per-email",
    useCase: "per-email-password",
    title: "Different email and password",
    description:
      "Use a separate email and password for each sign-in. They all belong to one account.",
    connectionKeys: ["per-email"],
  },
  "per-brand": {
    model: "per-brand",
    useCase: "per-brand-password",
    title: "Same email, different brand password",
    description:
      "Keep one email but set a separate password for each brand you shop with.",
    connectionKeys: ["dewalt", "stanley"],
  },
}

// --- Cross-brand confirm copy -----------------------------------------------

/**
 * The Model-4 "confirm it's you" collision sentence, shown when the email
 * already owns the OTHER brand and we're about to add THIS brand. Kept as a
 * pure string (never inline JSX text) so the space after the brand name can't
 * be swallowed by JSX whitespace-collapse — the exact defect that rendered
 * "…already has a Stanleyaccount." Both brand names are interpolated with
 * explicit surrounding spaces and unit-tested for DeWalt and Stanley.
 */
export function crossBrandConfirmMessage(
  brandName: string,
  otherBrandName: string,
): string {
  return `This email already has a ${otherBrandName} account. Confirm you own it and we'll add ${brandName} — no duplicate account.`
}

// --- Market gating ----------------------------------------------------------

/**
 * The account-model choice is only offered on UK deployments. Every other
 * market keeps the existing shared (Model 1/2) registration untouched.
 */
export function accountModelSelectionAvailable(market: CountryId): boolean {
  return market === "uk"
}

// --- Coherence: an account never mixes model 3 and model 4 ------------------
//
// A binding on the per-email connection is a Model-3 credential; one on a brand
// connection (dewalt/stanley) is a Model-4 credential. The `shared` connection
// is the Model-1/2 base and belongs to neither family, so it never conflicts.
// A coherent account carries credentials from AT MOST ONE of the two families.

/** The scoped (non-shared) connection key family a binding belongs to. */
function bindingModel(binding: CredentialBinding): AccountModel | null {
  if (binding.connectionKey === "per-email") return "per-email"
  if (binding.connectionKey === "dewalt" || binding.connectionKey === "stanley") {
    return "per-brand"
  }
  return null // shared / anything else
}

/**
 * The single account model a set of bindings already commits to, or null when
 * there are only shared (or no) scoped credentials. Throws nothing — a mixed
 * set is reported by `bindingsMixModels`, this returns the FIRST family seen.
 */
export function accountModelForBindings(
  bindings: CredentialBinding[],
): AccountModel | null {
  for (const b of bindings) {
    const m = bindingModel(b)
    if (m) return m
  }
  return null
}

/** True when a set of bindings ALREADY (incoherently) mixes both models. */
export function bindingsMixModels(bindings: CredentialBinding[]): boolean {
  let sawPerEmail = false
  let sawPerBrand = false
  for (const b of bindings) {
    const m = bindingModel(b)
    if (m === "per-email") sawPerEmail = true
    else if (m === "per-brand") sawPerBrand = true
    if (sawPerEmail && sawPerBrand) return true
  }
  return false
}

/**
 * Whether adding a credential belonging to `model` keeps the account coherent.
 * Adding is allowed only when the account has no committed family yet, or its
 * committed family already equals `model`. Fails closed if the existing set is
 * itself already mixed.
 */
export function accountModelAdditionAllowed(
  model: AccountModel,
  existingBindings: CredentialBinding[],
): boolean {
  if (bindingsMixModels(existingBindings)) return false
  const committed = accountModelForBindings(existingBindings)
  return committed === null || committed === model
}

// --- Shared registration context --------------------------------------------

/**
 * The server-resolved facts a registration plan is computed against. The
 * calling endpoint builds this from SITE_MARKET / SITE_BRAND and env-resolved
 * connection names — never from the browser request.
 */
export interface RegistrationContext {
  market: CountryId
  siteBrand: BrandId
  /** Env-resolved connection NAME per key (undefined when not configured). */
  connectionNames: Record<ConnectionKey, string | undefined>
}

function connectionConfigured(
  ctx: RegistrationContext,
  key: ConnectionKey,
): string | undefined {
  const name = ctx.connectionNames[key]
  return name && name.trim() ? name.trim() : undefined
}

// --- Model 3: multi-email registration planning -----------------------------

export interface Model3RegistrationInput {
  /** The first (required) email for the account. */
  primaryEmail: unknown
  /** An optional second email to also provision now (may be omitted/skipped). */
  secondaryEmail?: unknown
}

export type Model3RejectReason =
  | "market-unavailable"
  | "invalid-primary-email"
  | "invalid-secondary-email"
  | "duplicate-email"
  | "not-configured"

export interface Model3PlannedIdentity {
  email: string
  role: "primary" | "secondary"
}

export interface Model3Plan {
  ok: true
  model: "per-email"
  connectionKey: "per-email"
  connectionName: string
  useCase: "per-email-password"
  /** One or two identities to create on the per-email connection. */
  identities: Model3PlannedIdentity[]
  /** Whether a second identity is part of this plan (else complete it later). */
  hasSecondary: boolean
}

export type Model3Resolution = Model3Plan | { ok: false; reason: Model3RejectReason }

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function emailShaped(email: string): boolean {
  return EMAIL_SHAPE.test(email)
}

/**
 * Plan a Model-3 (per-email) registration. Both identities live on the
 * per-email connection and are later linked under one primary profile. The
 * second email is OPTIONAL — when omitted the plan carries a single identity and
 * `hasSecondary: false`, so the caller can offer a later completion journey
 * rather than generic profile provisioning. Fails closed on a malformed email,
 * the same email given twice, or the per-email connection not being configured.
 */
export function planModel3Registration(
  input: Model3RegistrationInput,
  ctx: RegistrationContext,
): Model3Resolution {
  if (!accountModelSelectionAvailable(ctx.market)) {
    return { ok: false, reason: "market-unavailable" }
  }

  const primary = normalizeEmail(input.primaryEmail)
  if (!primary || !emailShaped(primary)) {
    return { ok: false, reason: "invalid-primary-email" }
  }

  const connectionName = connectionConfigured(ctx, "per-email")
  if (!connectionName) return { ok: false, reason: "not-configured" }

  const identities: Model3PlannedIdentity[] = [{ email: primary, role: "primary" }]

  // The second email is optional; only validate it when something was supplied.
  const rawSecondary = input.secondaryEmail
  const suppliedSecondary =
    typeof rawSecondary === "string" && rawSecondary.trim().length > 0
  if (suppliedSecondary) {
    const secondary = normalizeEmail(rawSecondary)
    if (!secondary || !emailShaped(secondary)) {
      return { ok: false, reason: "invalid-secondary-email" }
    }
    if (secondary === primary) return { ok: false, reason: "duplicate-email" }
    identities.push({ email: secondary, role: "secondary" })
  }

  return {
    ok: true,
    model: "per-email",
    connectionKey: "per-email",
    connectionName,
    useCase: "per-email-password",
    identities,
    hasSecondary: identities.length > 1,
  }
}

// --- Model 3: signed email-set binding for the sign-up handoff --------------

/**
 * The NON-secret payload carried (signed, purpose-bound) across the signed-out
 * Model-3 sign-up. It BINDS the candidate email set to the journey — nothing
 * more. It deliberately does NOT record "verified" emails: ownership is proven
 * only by CONSUMING a one-time code at the IdP during the final create request
 * (see registerModel3WithProof), never by a flag in a stateless cookie a copy
 * of which would otherwise survive until expiry. It never holds a password,
 * code, or token. Emails are stored normalized (trimmed/lowercased).
 */
export interface Model3RegisterBinding extends Record<string, unknown> {
  primaryEmail: string
  /** Present only when a second email is part of this sign-up. */
  secondaryEmail?: string
}

// --- Model 3: pre-provision collision guard ---------------------------------
//
// A per-email (Model 3) sign-up must NEVER mint a standalone Auth0 user for an
// email that an existing account already owns — that splits one person into two
// accounts (the live defect: registering per-email on DeWalt UK for an email
// that already had a Stanley brand account created a SECOND Auth0 user). Worse,
// when the email already owns the OTHER UK brand (a Model-4 per-brand account),
// the coherent resolution is NOT a per-email account at all — it is a SECOND
// brand password on that SAME account, added through the existing cross-brand
// proof flow. This pure planner decides, from server-resolved facts, whether a
// per-email create may PROCEED, must DIVERT to the cross-brand flow, must tell
// the customer they are ALREADY REGISTERED, or must FAIL CLOSED. It never lets a
// per-email credential and a brand credential land on one account.

/** Server-resolved facts about the account (if any) that owns the sign-up email. */
export type PerEmailExistingFacts =
  | { kind: "none" }
  | { kind: "configured-off" }
  | { kind: "unavailable" }
  | { kind: "ambiguous" }
  | {
      kind: "single"
      /** The owning account's coherent bindings. */
      bindings: CredentialBinding[]
      /** Whether the sign-up mailbox is a verified/owned email on that account. */
      sameMailboxVerified: boolean
    }

export interface PerEmailGuardContext {
  /** The existing account that OWNS the sign-up email, resolved server-side. */
  existing: PerEmailExistingFacts
  /** This storefront's brand connection key (null for a non-brand storefront). */
  thisBrandKey: "dewalt" | "stanley" | null
}

export type PerEmailGuardDecision =
  /** No existing account owns the email → mint the per-email identity. */
  | { kind: "proceed" }
  /**
   * The email already owns the OTHER UK brand → do NOT mint a per-email user;
   * add THIS brand as a second brand password via the cross-brand proof flow.
   */
  | { kind: "divert-cross-brand"; proofOptions: ("password" | "email-code")[] }
  /** An account already owns this email here (this brand, or a per-email one). */
  | { kind: "already-registered" }
  /** Management not configured → the storefront runs its Demo behaviour. */
  | { kind: "not-configured" }
  /** Ambiguous / unavailable / incoherent → refuse, neutrally. */
  | { kind: "fail-closed" }

/**
 * Decide whether a per-email (Model 3) registration may proceed for an email,
 * given the account that already owns it. Fails CLOSED on anything but a clear
 * "no owner" or a clean cross-brand link opportunity — it must be impossible for
 * this to green-light minting a second Auth0 user for an email an account
 * already owns, or to mix a per-email and a brand credential on one account.
 */
export function planPerEmailRegistrationGuard(
  ctx: PerEmailGuardContext,
): PerEmailGuardDecision {
  const { existing } = ctx
  switch (existing.kind) {
    case "none":
      return { kind: "proceed" }
    case "configured-off":
      return { kind: "not-configured" }
    case "unavailable":
    case "ambiguous":
      return { kind: "fail-closed" }
    case "single": {
      const b = existing.bindings
      // An already-incoherent set → never touch it.
      if (bindingsMixModels(b)) return { kind: "fail-closed" }
      const family = accountModelForBindings(b)

      // Already a per-email account for this email → don't mint a duplicate.
      if (family === "per-email") return { kind: "already-registered" }

      // A per-brand (Model 4) account owns the email.
      if (family === "per-brand") {
        const thisKey = ctx.thisBrandKey
        if (!thisKey) return { kind: "fail-closed" } // no brand key → cannot divert
        // This brand already present → nothing to add; sign in.
        if (b.some((x) => x.connectionKey === thisKey)) {
          return { kind: "already-registered" }
        }
        // Owns the OTHER brand only → add THIS brand via the cross-brand proof.
        return {
          kind: "divert-cross-brand",
          proofOptions: existing.sameMailboxVerified
            ? ["password", "email-code"]
            : ["password"],
        }
      }

      // family === null: a shared-only (EU Model 1/2) or scoped-empty account
      // already owns this email. Minting a per-email user would create a second
      // account for one person → fail closed (neutral).
      return { kind: "fail-closed" }
    }
  }
}

// --- Model 4: first-brand registration planning -----------------------------

export type Model4RejectReason =
  | "market-unavailable"
  | "invalid-email"
  | "unsupported-brand"
  | "not-configured"

export interface Model4Plan {
  ok: true
  model: "per-brand"
  brand: BrandId
  connectionKey: "dewalt" | "stanley"
  connectionName: string
  useCase: "per-brand-password"
  email: string
}

export type Model4Resolution = Model4Plan | { ok: false; reason: Model4RejectReason }

/** The brand connection key for a storefront brand, or null if it has none. */
export function brandConnectionKey(
  brand: BrandId,
): "dewalt" | "stanley" | null {
  if (brand === "dewalt") return "dewalt"
  if (brand === "stanley") return "stanley"
  return null
}

/**
 * Plan a Model-4 (per-brand) FIRST registration on the current storefront
 * brand. Creates that brand's identity for the given email. Fails closed on a
 * malformed email, a storefront brand that has no brand connection (e.g.
 * craftsman), a brand not allowed on this key, or an unconfigured connection.
 */
export function planModel4Registration(
  input: { email: unknown },
  ctx: RegistrationContext,
): Model4Resolution {
  if (!accountModelSelectionAvailable(ctx.market)) {
    return { ok: false, reason: "market-unavailable" }
  }

  const email = normalizeEmail(input.email)
  if (!email || !emailShaped(email)) return { ok: false, reason: "invalid-email" }

  const key = brandConnectionKey(ctx.siteBrand)
  if (!key || !isBrandAllowed(key, ctx.siteBrand)) {
    return { ok: false, reason: "unsupported-brand" }
  }

  const connectionName = connectionConfigured(ctx, key)
  if (!connectionName) return { ok: false, reason: "not-configured" }

  return {
    ok: true,
    model: "per-brand",
    brand: ctx.siteBrand,
    connectionKey: key,
    connectionName,
    useCase: "per-brand-password",
    email,
  }
}

// --- Model 4: cross-brand link planning -------------------------------------
//
// A customer who already registered on the OTHER UK brand comes to this brand,
// re-registers with the SAME email but a DIFFERENT password. We must NOT create
// a standalone duplicate: detect the existing account, require proof of
// ownership (password or one-time email code, verified by the endpoint), then
// link a NEW brand identity under the existing primary profile.

export interface Model4ExistingAccount {
  /** The Auth0 primary user id the new brand identity will link under. */
  auth0UserId: string
  /** The existing account's coherent bindings (used for conflict checks). */
  bindings: CredentialBinding[]
}

export interface Model4CrossBrandContext {
  market: CountryId
  siteBrand: BrandId
  /** The re-registration email (raw; normalized here). */
  email: unknown
  /**
   * The SINGLE existing primary account resolved server-side, or null when
   * there is none OR the lookup was ambiguous (the caller collapses an ambiguous
   * multi-match to null so this plan fails closed).
   */
  existingAccount: Model4ExistingAccount | null
  /** Whether ownership proof (password or email code) has been verified. */
  proofVerified: boolean
  /**
   * Whether the email is VERIFIED on the existing account (root
   * `email_verified`, or an OTP-proven linked alias). A fresh Model 4 root is
   * created unverified until its confirmation link is used; linking a second
   * brand onto an unconfirmed root would let an unproven mailbox gain a credential.
   */
  ownershipEmailVerified: boolean
  connectionNames: Record<ConnectionKey, string | undefined>
}

export type Model4LinkRejectReason =
  | "email-unverified"
  | "market-unavailable"
  | "invalid-email"
  | "unsupported-brand"
  | "not-configured"
  | "no-existing-account"
  | "proof-required"
  | "duplicate-brand-credential"
  | "model-conflict"

export interface Model4LinkPlan {
  ok: true
  brand: BrandId
  connectionKey: "dewalt" | "stanley"
  connectionName: string
  useCase: "per-brand-password"
  email: string
  /** Link the newly created brand identity under this existing primary. */
  primaryUserId: string
}

export type Model4LinkResolution =
  | Model4LinkPlan
  | { ok: false; reason: Model4LinkRejectReason }

/**
 * Plan linking a SECOND brand's identity onto an existing UK account. Fails
 * closed unless: the market is UK, the email is well-formed, the storefront
 * brand has a configured connection, EXACTLY one existing account was resolved,
 * ownership proof is verified, the existing account is a Model-4 (per-brand)
 * account (never a Model-3 per-email account — that would mix models), and this
 * brand does not already have a credential on the account.
 */
export function planModel4CrossBrandLink(
  ctx: Model4CrossBrandContext,
): Model4LinkResolution {
  if (!accountModelSelectionAvailable(ctx.market)) {
    return { ok: false, reason: "market-unavailable" }
  }

  const email = normalizeEmail(ctx.email)
  if (!email || !emailShaped(email)) return { ok: false, reason: "invalid-email" }

  const key = brandConnectionKey(ctx.siteBrand)
  if (!key || !isBrandAllowed(key, ctx.siteBrand)) {
    return { ok: false, reason: "unsupported-brand" }
  }

  const name = ctx.connectionNames[key]
  const connectionName = name && name.trim() ? name.trim() : undefined
  if (!connectionName) return { ok: false, reason: "not-configured" }

  // Fail closed when no single account was resolved (none, or ambiguous → null).
  if (!ctx.existingAccount) return { ok: false, reason: "no-existing-account" }

  // Proof of ownership must already be verified by the endpoint.
  if (!ctx.proofVerified) return { ok: false, reason: "proof-required" }

  if (!ctx.ownershipEmailVerified) return { ok: false, reason: "email-unverified" }

  const existing = ctx.existingAccount.bindings

  // The existing account must not be a Model-3 (per-email) account — linking a
  // brand credential onto it would mix models. Also refuse an already-mixed set.
  if (
    bindingsMixModels(existing) ||
    accountModelForBindings(existing) === "per-email"
  ) {
    return { ok: false, reason: "model-conflict" }
  }

  // This brand must not already have a credential on the account.
  const alreadyOnBrand = existing.some((b) => b.connectionKey === key)
  if (alreadyOnBrand) return { ok: false, reason: "duplicate-brand-credential" }

  return {
    ok: true,
    brand: ctx.siteBrand,
    connectionKey: key,
    connectionName,
    useCase: "per-brand-password",
    email,
    primaryUserId: ctx.existingAccount.auth0UserId,
  }
}

// --- Model 3 completion (add the deferred second email later) ---------------

export interface Model3CompletionContext {
  market: CountryId
  /** The signed-in primary account's Auth0 user id. */
  primaryUserId: string
  /** The account's existing bindings (used for coherence + duplicate checks). */
  existingBindings: CredentialBinding[]
  /** The second email being added (raw; normalized here). */
  email: unknown
  /** Whether ownership of `email` has been proven (one-time email code). */
  ownershipVerified: boolean
  connectionNames: Record<ConnectionKey, string | undefined>
}

export type Model3CompletionRejectReason =
  | "market-unavailable"
  | "invalid-email"
  | "not-configured"
  | "ownership-required"
  | "duplicate-email-credential"
  | "model-conflict"

export interface Model3CompletionPlan {
  ok: true
  connectionKey: "per-email"
  connectionName: string
  useCase: "per-email-password"
  email: string
  primaryUserId: string
}

export type Model3CompletionResolution =
  | Model3CompletionPlan
  | { ok: false; reason: Model3CompletionRejectReason }

/**
 * Plan linking a deferred SECOND per-email identity onto an existing Model-3
 * account (the completion journey for a sign-up where the second email was
 * skipped). Fails closed unless: the market is UK, the email is well-formed, the
 * per-email connection is configured, ownership of the new email is proven, the
 * account is NOT a per-brand (Model-4) account (that would mix models), and the
 * email does not already have a per-email credential on the account.
 */
export function planModel3Completion(
  ctx: Model3CompletionContext,
): Model3CompletionResolution {
  if (!accountModelSelectionAvailable(ctx.market)) {
    return { ok: false, reason: "market-unavailable" }
  }

  const email = normalizeEmail(ctx.email)
  if (!email || !emailShaped(email)) return { ok: false, reason: "invalid-email" }

  const name = ctx.connectionNames["per-email"]
  const connectionName = name && name.trim() ? name.trim() : undefined
  if (!connectionName) return { ok: false, reason: "not-configured" }

  if (!ctx.ownershipVerified) return { ok: false, reason: "ownership-required" }

  // Adding a per-email credential must keep the account coherent (never mix with
  // an existing per-brand family, and never onto an already-mixed set).
  if (!accountModelAdditionAllowed("per-email", ctx.existingBindings)) {
    return { ok: false, reason: "model-conflict" }
  }

  // The email must not already have its own per-email credential here.
  const alreadyBound = ctx.existingBindings.some(
    (b) => b.connectionKey === "per-email" && normalizeEmail(b.email) === email,
  )
  if (alreadyBound) return { ok: false, reason: "duplicate-email-credential" }

  return {
    ok: true,
    connectionKey: "per-email",
    connectionName,
    useCase: "per-email-password",
    email,
    primaryUserId: ctx.primaryUserId,
  }
}

/**
 * Customer-facing explanation when Create Account is attempted with a demo model
 * the existing account does NOT use (Model 3 and Model 4 are alternative
 * credential boundaries; one account never mixes them). Neutral about anything
 * beyond "this email already has an account with a different sign-in setup",
 * and always gives a safe way forward. Nothing is created or converted.
 */
export function modelMismatchMessage(
  existing: "per-email" | "per-brand" | "other",
  perEmailEnabled: boolean = UK_PER_EMAIL_ACCOUNTS_FLAG,
): string {
  // With the per-email setup off, an existing per-email account gets neutral
  // guidance that never offers that setup as a choice.
  if (existing === "per-email" && !perEmailEnabled) return LEGACY_PER_EMAIL_ACCOUNT_MESSAGE
  if (existing === "per-email") {
    return "This email already has an account that uses one password per email address. That password works on both UK storefronts, so sign in with it instead. A separate brand password can't be added to this account."
  }
  if (existing === "per-brand") {
    return "This email already has an account that uses a separate password for each brand. Choose the separate brand password option to add this brand, or sign in with your existing brand password."
  }
  return "This email already has an account with a different sign-in setup. Sign in with your existing details instead."
}

// --- Model 4 second-brand signup against an existing account ----------------

export type BrandProofMethod = "password" | "email-code"

export type BrandSignupExistingDecision =
  | { kind: "model-mismatch"; existingModel: "per-email" | "other" }
  | { kind: "already-brand" }
  | { kind: "verification-required" }
  | { kind: "proof-required"; proofOptions: BrandProofMethod[] }

/** Guidance when the existing brand account's email has not been confirmed yet. */
export function unverifiedBrandAccountMessage(): string {
  return "This email already has an account on the other UK storefront, but its email address hasn't been confirmed yet. Use the confirmation link we emailed when that account was created (or sign in there and resend it from your profile), then come back to add this brand. Nothing has been changed."
}

/**
 * What a UK per-brand (Model 4) signup does when the email already belongs to
 * exactly ONE account. Same-model (the account already holds the OTHER brand's
 * password) → ownership proof, then this brand is linked to that SAME root.
 * Cross-model (a per-email account, or one with no brand password) → refuse
 * with a model-mismatch; nothing is created, converted, or mixed.
 *
 * The email must already be VERIFIED on that account (root `email_verified`,
 * set by the first brand's confirmation link, or an OTP-proven alias). An
 * unconfirmed root is refused with `verification-required` and guidance to
 * finish the first brand's verification — never linked.
 *
 * When verified, both proofs are offered: the other brand's password, or an
 * emailed one-time code to that verified address.
 */
export function planBrandSignupForExistingAccount(params: {
  connectionKey: "dewalt" | "stanley"
  email: string
  account: { bindings: CredentialBinding[]; verifiedEmails: string[] }
}): BrandSignupExistingDecision {
  const { bindings } = params.account
  const hasPerBrand = bindings.some(
    (b) => b.connectionKey === "dewalt" || b.connectionKey === "stanley",
  )
  const hasPerEmail = bindings.some((b) => b.connectionKey === "per-email")
  if (!hasPerBrand || hasPerEmail) {
    return { kind: "model-mismatch", existingModel: hasPerEmail ? "per-email" : "other" }
  }
  if (bindings.some((b) => b.connectionKey === params.connectionKey)) {
    return { kind: "already-brand" }
  }
  const email = normalizeEmail(params.email)
  const verified = params.account.verifiedEmails.some((e) => normalizeEmail(e) === email)
  if (!email || !verified) return { kind: "verification-required" }
  return { kind: "proof-required", proofOptions: ["password", "email-code"] }
}

/** Whether a submitted proof method was actually offered for this account. */
export function brandProofMethodAllowed(
  offered: readonly unknown[] | undefined,
  method: BrandProofMethod,
): boolean {
  if (method === "password") return true
  return Array.isArray(offered) && offered.includes("email-code")
}
