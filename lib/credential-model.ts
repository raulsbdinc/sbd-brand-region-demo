// CREDENTIAL MODEL — ALLOWLISTED CONNECTION KEYS + PURE RESOLVER
// =============================================================
// The four demo use cases (see DEMO_STATUS.md) differ ONLY by which Auth0
// database connection backs a person's password:
//
//   1. Shared account      → one `sbd-eu` credential on all three storefronts.
//   2. Linked identities   → still the shared `sbd-eu` credential; alternates
//                            and Google are ways IN, not separate passwords.
//   3. Per-email passwords → each independently passworded email is its own
//                            credential on the per-email connection.
//   4. Per-brand passwords → a separate credential per brand (DeWalt / Stanley),
//                            each on that brand's own connection.
//
// This module is the single source of truth for how a submitted email + the
// deployment's SITE_BRAND resolve to exactly ONE database connection. It is
// deliberately FRAMEWORK-FREE (no "server-only") so the pure logic + the
// allow-list can be unit-tested and imported by both the server resolver and
// the client login-method view. It NEVER reads a raw connection NAME from the
// browser and never returns one to it — only the internal keys below cross a
// boundary; the raw names/ids stay on the server (see lib/credential-resolver).

import type { BrandId } from "./types"

// --- Allow-listed connection keys ------------------------------------------
// The ONLY connection identifiers the app will ever act on. A raw connection
// name from a request is never trusted; it must map to one of these keys first.
export type ConnectionKey = "shared" | "per-email" | "dewalt" | "stanley"

export const CONNECTION_KEYS: readonly ConnectionKey[] = [
  "shared",
  "per-email",
  "dewalt",
  "stanley",
] as const

const ALLOWED_CONNECTION_KEYS: ReadonlySet<ConnectionKey> = new Set(CONNECTION_KEYS)

/** Whether a value is an allow-listed connection key. */
export function isConnectionKey(value: unknown): value is ConnectionKey {
  return typeof value === "string" && ALLOWED_CONNECTION_KEYS.has(value as ConnectionKey)
}

// --- Demo use cases ---------------------------------------------------------
export type DemoUseCase =
  | "shared-account" // case 1
  | "linked-identities" // case 2
  | "per-email-password" // case 3
  | "per-brand-password" // case 4

const DEMO_USE_CASES: ReadonlySet<DemoUseCase> = new Set<DemoUseCase>([
  "shared-account",
  "linked-identities",
  "per-email-password",
  "per-brand-password",
])

export function isDemoUseCase(value: unknown): value is DemoUseCase {
  return typeof value === "string" && DEMO_USE_CASES.has(value as DemoUseCase)
}

// --- Connection-key metadata ------------------------------------------------
export interface ConnectionKeyMeta {
  key: ConnectionKey
  /** Short label for a login-method row, e.g. "DeWalt password". */
  label: string
  /** Human scope/model line shown under the row. */
  scope: string
  /**
   * SITE_BRANDs this connection is allowed to route on. `null` means every
   * storefront (shared + per-email). Case-4 connections are brand-restricted.
   */
  allowedBrands: BrandId[] | null
  /** The brand a case-4 connection belongs to (undefined for shared/per-email). */
  brand?: BrandId
  /** The use case this connection embodies. */
  useCase: DemoUseCase
}

export const CONNECTION_KEY_META: Record<ConnectionKey, ConnectionKeyMeta> = {
  shared: {
    key: "shared",
    label: "Email & password",
    scope: "One password for DeWalt France, DeWalt Germany and Stanley France.",
    allowedBrands: null,
    useCase: "shared-account",
  },
  "per-email": {
    key: "per-email",
    label: "Per-email password",
    scope: "This email has its own password, resolving to one customer profile.",
    allowedBrands: null,
    useCase: "per-email-password",
  },
  dewalt: {
    key: "dewalt",
    label: "DeWalt password",
    scope: "A DeWalt-only password, separate from your other brand sign-ins.",
    allowedBrands: ["dewalt"],
    brand: "dewalt",
    useCase: "per-brand-password",
  },
  stanley: {
    key: "stanley",
    label: "Stanley password",
    scope: "A Stanley-only password, separate from your other brand sign-ins.",
    allowedBrands: ["stanley"],
    brand: "stanley",
    useCase: "per-brand-password",
  },
}

/** Whether a connection key is permitted to route on a given storefront brand. */
export function isBrandAllowed(key: ConnectionKey, brand: BrandId): boolean {
  const allowed = CONNECTION_KEY_META[key].allowedBrands
  return allowed === null || allowed.includes(brand)
}

// --- Env → connection name / id resolution ----------------------------------
// The mapping from an internal key to the tenant's real connection NAME (used
// as the password-realm `realm`) and its connection ID (used by Management API
// password-reset / link calls). Both are SERVER-ONLY values; they are resolved
// from env here (a plain function so it is testable with a supplied env map)
// and never sent to or accepted from the browser.

export type EnvLike = Record<string, string | undefined>

/** Fallback used for the shared connection when no env var is present. */
export const SHARED_CONNECTION_FALLBACK = "sbd-eu"

/**
 * Resolve the tenant connection NAME for each key from env.
 *   shared    → AUTH0_SHARED_CONNECTION | AUTH0_CONNECTION |
 *               NEXT_PUBLIC_AUTH0_CONNECTION | "sbd-eu"
 *   per-email → AUTH0_PER_EMAIL_CONNECTION
 *   dewalt    → AUTH0_DEWALT_CONNECTION
 *   stanley   → AUTH0_STANLEY_CONNECTION
 * A key with no configured name (and no fallback) resolves to `undefined`.
 */
export function resolveConnectionNames(
  env: EnvLike = process.env as EnvLike,
): Record<ConnectionKey, string | undefined> {
  const pick = (...vals: (string | undefined)[]) => {
    for (const v of vals) {
      const trimmed = v?.trim()
      if (trimmed) return trimmed
    }
    return undefined
  }
  return {
    shared: pick(
      env.AUTH0_SHARED_CONNECTION,
      env.AUTH0_CONNECTION,
      env.NEXT_PUBLIC_AUTH0_CONNECTION,
      SHARED_CONNECTION_FALLBACK,
    ),
    "per-email": pick(env.AUTH0_PER_EMAIL_CONNECTION),
    dewalt: pick(env.AUTH0_DEWALT_CONNECTION),
    stanley: pick(env.AUTH0_STANLEY_CONNECTION),
  }
}

/**
 * Resolve the Management-API connection ID for each key (password-reset / link
 * management calls). No fallback — an unset id resolves to `undefined`.
 */
export function resolveConnectionIds(
  env: EnvLike = process.env as EnvLike,
): Record<ConnectionKey, string | undefined> {
  const t = (v: string | undefined) => v?.trim() || undefined
  return {
    shared: t(env.AUTH0_SHARED_CONNECTION_ID),
    "per-email": t(env.AUTH0_PER_EMAIL_CONNECTION_ID),
    dewalt: t(env.AUTH0_DEWALT_CONNECTION_ID),
    stanley: t(env.AUTH0_STANLEY_CONNECTION_ID),
  }
}

/** The set of keys that have a usable connection name configured. */
export function configuredConnectionKeys(
  names: Record<ConnectionKey, string | undefined>,
): Set<ConnectionKey> {
  const set = new Set<ConnectionKey>()
  for (const key of CONNECTION_KEYS) {
    if (names[key]) set.add(key)
  }
  return set
}

/**
 * Reverse-map a raw connection NAME to its internal key, preferring the more
 * specific (non-shared) keys on a collision. Returns null for an unknown name
 * so an unrecognised connection is never treated as routable.
 */
export function connectionKeyForName(
  name: string | undefined | null,
  names: Record<ConnectionKey, string | undefined>,
): ConnectionKey | null {
  if (!name) return null
  const order: ConnectionKey[] = ["per-email", "dewalt", "stanley", "shared"]
  for (const key of order) {
    if (names[key] && names[key] === name) return key
  }
  return null
}

// --- Credential bindings ----------------------------------------------------
// Non-secret metadata describing ONE password-bearing database credential that
// belongs to a customer. Bindings live on the PRIMARY account's app_metadata
// (never passwords or tokens). They make an already-seeded/linked case-3 or
// case-4 credential routable, visible and independently resettable.
export interface CredentialBinding {
  /** Stable id (used to target a reset). */
  id: string
  /** Normalized (lowercased, trimmed) email the credential signs in with. */
  email: string
  /** Allow-listed connection key backing this credential. */
  connectionKey: ConnectionKey
  /** The Auth0 provider user id of the linked identity for this credential. */
  auth0UserId: string
  /** Which demo use case this binding embodies. */
  useCase: DemoUseCase
  /** Brand for a case-4 credential (undefined for shared/per-email). */
  brand?: BrandId
}

/** Lowercase + trim an email for comparison/storage. */
export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

// --- Password-model summary (drives cross-brand recognition copy) -----------
export interface PasswordModelSummary {
  /** The account has at least one per-brand (case 4) credential. */
  perBrand: boolean
  /** The account has at least one per-email (case 3) credential. */
  perEmail: boolean
  /** Distinct brands that have their own password. */
  brands: BrandId[]
  /**
   * True only when the account is a pure shared-password account (cases 1 & 2):
   * NO per-email and NO per-brand credentials. This is the ONLY case that may
   * claim "one password" in customer-facing copy.
   */
  singleSharedPassword: boolean
}

/**
 * Summarize a set of credential bindings into the password topology the account
 * actually has, so customer-facing copy can stop assuming "one password" when a
 * case-3/4 credential exists. A binding set with no non-shared credentials
 * yields `singleSharedPassword: true` (the unchanged cases 1 & 2 wording).
 */
export function summarizePasswordModel(
  bindings: CredentialBinding[],
): PasswordModelSummary {
  const brandSet = new Set<BrandId>()
  let perBrand = false
  let perEmail = false
  for (const b of bindings) {
    if (b.useCase === "per-brand-password") {
      perBrand = true
      if (b.brand) brandSet.add(b.brand)
    } else if (b.useCase === "per-email-password") {
      perEmail = true
    }
  }
  return {
    perBrand,
    perEmail,
    brands: Array.from(brandSet),
    singleSharedPassword: !perBrand && !perEmail,
  }
}

/** A login-method-ish shape carrying the fields the topology summary needs. */
export interface PasswordCredentialLike {
  kind?: string
  connectionKey?: ConnectionKey | null
  brand?: BrandId | null
}

/**
 * Summarize the password topology from the Management-backed LOGIN METHODS the
 * account actually exposes (the source the browser can legitimately see, via
 * /api/account/login-methods). Used by the customer profile because
 * `app_metadata` is NOT present in the OIDC session — deriving topology from
 * the session user would always read as a single shared password. Only
 * password-kind methods with a per-email / per-brand connection key count.
 */
export function summarizePasswordModelFromMethods(
  methods: PasswordCredentialLike[],
): PasswordModelSummary {
  const brandSet = new Set<BrandId>()
  let perBrand = false
  let perEmail = false
  for (const m of methods) {
    if (m.kind && m.kind !== "password") continue
    if (m.connectionKey === "per-email") {
      perEmail = true
    } else if (m.connectionKey === "dewalt" || m.connectionKey === "stanley") {
      perBrand = true
      if (m.brand) brandSet.add(m.brand)
    }
  }
  return {
    perBrand,
    perEmail,
    brands: Array.from(brandSet),
    singleSharedPassword: !perBrand && !perEmail,
  }
}

/**
 * Whether a set of login methods contains a REAL shared password credential —
 * a password-kind method whose connection key is `shared` or is untagged (the
 * shared demo account). Drives whether the account view shows the single
 * top-level (shared) password reset; a case-3/4-only account has none, so it
 * must reset through its per-row actions instead of a misleading global button.
 */
export function hasSharedPasswordCredential(
  methods: PasswordCredentialLike[],
): boolean {
  return methods.some(
    (m) =>
      (!m.kind || m.kind === "password") &&
      (m.connectionKey === undefined ||
        m.connectionKey === null ||
        m.connectionKey === "shared"),
  )
}

const BRAND_IDS: ReadonlySet<string> = new Set<BrandId>(["dewalt", "craftsman", "stanley"])

/**
 * Read one raw binding-ish value into a valid CredentialBinding, or null when
 * it is malformed, carries an unknown (non-allow-listed) connection key / use
 * case, OR is INCOHERENT. Coherence is enforced, never normalized away — a
 * binding whose (connectionKey, useCase, brand) do not agree is REJECTED rather
 * than silently coerced into a misleading UI row:
 *   • shared    → useCase shared-account | linked-identities, and NO brand.
 *   • per-email → useCase per-email-password, and NO brand.
 *   • dewalt    → useCase per-brand-password, and brand dewalt (or absent).
 *   • stanley   → useCase per-brand-password, and brand stanley (or absent).
 * Never throws — junk is silently dropped.
 */
export function sanitizeCredentialBinding(input: unknown): CredentialBinding | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>

  const connectionKey = raw.connectionKey
  if (!isConnectionKey(connectionKey)) return null // ALLOW-LIST enforcement

  const useCase = raw.useCase
  if (!isDemoUseCase(useCase)) return null

  const email = normalizeEmail(raw.email)
  if (!email) return null

  const auth0UserId = typeof raw.auth0UserId === "string" ? raw.auth0UserId.trim() : ""
  if (!auth0UserId) return null

  // A brand value, if present, must itself be a known brand id. A present but
  // unknown brand string is malformed → reject.
  let rawBrand: BrandId | undefined
  if (raw.brand !== undefined && raw.brand !== null) {
    if (typeof raw.brand !== "string" || !BRAND_IDS.has(raw.brand)) return null
    rawBrand = raw.brand as BrandId
  }

  // Coherence: (connectionKey, useCase, brand) must agree. Reject mismatches.
  let brand: BrandId | undefined
  switch (connectionKey) {
    case "shared":
      if (useCase !== "shared-account" && useCase !== "linked-identities") return null
      if (rawBrand !== undefined) return null
      brand = undefined
      break
    case "per-email":
      if (useCase !== "per-email-password") return null
      if (rawBrand !== undefined) return null
      brand = undefined
      break
    case "dewalt":
      if (useCase !== "per-brand-password") return null
      if (rawBrand !== undefined && rawBrand !== "dewalt") return null
      brand = "dewalt"
      break
    case "stanley":
      if (useCase !== "per-brand-password") return null
      if (rawBrand !== undefined && rawBrand !== "stanley") return null
      brand = "stanley"
      break
  }

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${connectionKey}:${auth0UserId}`

  return { id, email, connectionKey, auth0UserId, useCase, brand }
}

/** Read a whole `app_metadata.credential_bindings`-ish value into clean bindings. */
export function sanitizeCredentialBindings(input: unknown): CredentialBinding[] {
  const arr = Array.isArray(input) ? input : []
  const out: CredentialBinding[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    const b = sanitizeCredentialBinding(item)
    if (!b) continue
    const dedupeKey = `${b.connectionKey}|${b.auth0UserId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(b)
  }
  return out
}

// --- The pure resolver ------------------------------------------------------
/** One of the signed-in account's linked database identities, key-mapped. */
export interface LinkedDbIdentity {
  connectionKey: ConnectionKey | null
  userId: string
}

// Discriminated result so callers can distinguish a resolved NON-SHARED
// credential from a shared-default attempt from an AMBIGUOUS email:
//   • kind "resolved"       → a unique, backed, brand-permitted non-shared
//                             credential; attempt ONLY that realm.
//   • kind "shared-default" → no non-shared match; the caller may make the
//                             ordinary shared attempt (cases 1 & 2, and unknown
//                             emails — a neutral shared attempt is still fine).
//   • reason "ambiguous"    → the email matches more than one credential (e.g. a
//                             real shared login AND a non-shared credential, or
//                             two non-shared credentials); the caller MUST fail
//                             closed and attempt NO realm.
//   • reason "not-configured" → the shared connection itself is not configured.
export type CredentialResolution =
  | { ok: true; kind: "resolved"; connectionKey: ConnectionKey; binding: CredentialBinding }
  | { ok: true; kind: "shared-default"; connectionKey: "shared"; binding: null }
  | { ok: false; reason: "ambiguous" | "not-configured" }

/**
 * ONE candidate Auth0 record: the bindings it owns (from ITS app_metadata) and
 * the linked database identities it actually has. Ownership is scoped to this
 * record — a binding here may only be validated by an identity here.
 */
export interface CandidateAccount {
  bindings: CredentialBinding[]
  identities: LinkedDbIdentity[]
}

export interface ResolveCredentialParams {
  email: string
  siteBrand: BrandId
  /** Bindings gathered from the candidate account(s)' app_metadata. */
  bindings: CredentialBinding[]
  /** The candidate account(s)' actual linked database identities. */
  identities: LinkedDbIdentity[]
  /** Connection keys that have a configured connection name. */
  configuredKeys: ReadonlySet<ConnectionKey>
  /**
   * Whether the submitted email is a GENUINE shared-connection login — i.e. it
   * is the root email or a persisted login alias of an account that actually
   * has a shared-connection identity (validated by the server bridge against
   * the real identities). A shared match that coincides with a non-shared match
   * is AMBIGUOUS: we must never silently prefer one realm over the other.
   */
  sharedMatch: boolean
}

export interface ResolveCredentialFromCandidatesParams {
  email: string
  siteBrand: BrandId
  /** Candidate Auth0 records; ownership is preserved per-record (no flattening). */
  candidates: CandidateAccount[]
  configuredKeys: ReadonlySet<ConnectionKey>
  sharedMatch: boolean
}

/**
 * Resolve exactly ONE database connection key for a submitted email on this
 * storefront across a set of CANDIDATE accounts, failing CLOSED on anything
 * ambiguous.
 *
 * ACCOUNT OWNERSHIP IS PRESERVED: a non-shared binding is only ever validated
 * against identities on the SAME candidate record that owns it. We must NOT let
 * a binding from account A be "backed" by an identity that exists only on
 * account B — that would let one customer's metadata borrow another's identity.
 *
 * Rules (applied to the same-account-validated matches across all candidates):
 *   • A non-shared binding counts only when it is allow-listed, its connection
 *     is configured, it is permitted on SITE_BRAND, AND it is backed by a real
 *     linked identity ON ITS OWN account.
 *   • Exactly one such match AND no genuine shared match → that connection.
 *   • More than one distinct match → AMBIGUOUS, fail closed.
 *   • Exactly one match BUT a genuine shared login for the same email →
 *     AMBIGUOUS, fail closed (never prefer shared or non-shared).
 *   • No match → shared-default (root users and login aliases — cases 1 & 2,
 *     unchanged, and unknown emails) when shared is configured; otherwise
 *     not-configured.
 */
export function resolveCredentialFromCandidates(
  params: ResolveCredentialFromCandidatesParams,
): CredentialResolution {
  const email = normalizeEmail(params.email)

  const matches: CredentialBinding[] = []
  const seen = new Set<string>()
  for (const account of params.candidates) {
    for (const b of account.bindings) {
      if (normalizeEmail(b.email) !== email) continue
      if (!isConnectionKey(b.connectionKey)) continue
      if (b.connectionKey === "shared") continue // shared is the default, below
      if (!params.configuredKeys.has(b.connectionKey)) continue
      if (!isBrandAllowed(b.connectionKey, params.siteBrand)) continue
      // SAME-ACCOUNT validation: the backing identity must be on THIS record.
      const backed = account.identities.some(
        (i) => i.connectionKey === b.connectionKey && i.userId === b.auth0UserId,
      )
      if (!backed) continue
      const dedupeKey = `${b.connectionKey}|${b.auth0UserId}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      matches.push(b)
    }
  }

  // Two or more distinct non-shared credentials → ambiguous.
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" }
  }

  // Exactly one non-shared credential.
  if (matches.length === 1) {
    // …but if the same email is ALSO a genuine shared login, we cannot choose:
    // fail closed rather than silently preferring the non-shared realm.
    if (params.sharedMatch) {
      return { ok: false, reason: "ambiguous" }
    }
    return { ok: true, kind: "resolved", connectionKey: matches[0].connectionKey, binding: matches[0] }
  }

  // No routable per-email/per-brand credential: the ordinary shared attempt
  // (root user or login alias — cases 1 & 2 — and unknown emails, unchanged).
  if (params.configuredKeys.has("shared")) {
    return { ok: true, kind: "shared-default", connectionKey: "shared", binding: null }
  }
  return { ok: false, reason: "not-configured" }
}

/**
 * Single-account convenience wrapper around {@link resolveCredentialFromCandidates}.
 * The supplied bindings + identities are treated as ONE candidate record, so
 * ownership is trivially preserved. Prefer the candidates form when more than
 * one Auth0 record is in play.
 */
export function resolveCredential(params: ResolveCredentialParams): CredentialResolution {
  return resolveCredentialFromCandidates({
    email: params.email,
    siteBrand: params.siteBrand,
    candidates: [{ bindings: params.bindings, identities: params.identities }],
    configuredKeys: params.configuredKeys,
    sharedMatch: params.sharedMatch,
  })
}

// --- Sign-in realm decision (shared by server callers, pure + testable) -----
/**
 * The outcome kinds a sign-in resolution can take once the server bridge has
 * consulted Auth0. `unavailable` means the candidate set could not be fully
 * gathered (a Management lookup/search failed while Management IS configured),
 * so absence of a case-3/4 credential or a collision cannot be proven — it must
 * fail closed exactly like `ambiguous`.
 */
export type SigninRealmDecisionKind =
  | "resolved"
  | "shared-default"
  | "ambiguous"
  | "unavailable"

/**
 * Whether a sign-in resolution permits ANY realm operation (a password
 * exchange, a passcode challenge, or a recovery reset). Only a positively
 * resolved non-shared credential or the ordinary shared-default attempt do;
 * `ambiguous` and `unavailable` both fail closed with NO realm operation.
 */
export function signinResolutionPermitsRealmOperation(
  kind: SigninRealmDecisionKind,
): boolean {
  return kind === "resolved" || kind === "shared-default"
}

// --- Reset-binding validation (authenticated password reset) ----------------
export type ResetBindingResolution =
  | { ok: true; binding: CredentialBinding }
  | { ok: false; reason: "not-found" | "not-configured" | "unbacked" | "not-allowlisted" }

export interface ResolveResetBindingParams {
  bindingId: string
  /** Bindings on the SIGNED-IN primary account. */
  bindings: CredentialBinding[]
  /** The signed-in primary account's actual linked identities. */
  identities: LinkedDbIdentity[]
  configuredKeys: ReadonlySet<ConnectionKey>
}

/**
 * Validate a credential-binding id against the signed-in account BEFORE issuing
 * a password-change ticket for it. The binding must exist on the account, use
 * an allow-listed + configured connection, and be backed by one of the
 * account's real linked identities — so a client can never reset a credential
 * that is not genuinely its own.
 */
export function resolveResetBinding(params: ResolveResetBindingParams): ResetBindingResolution {
  const id = typeof params.bindingId === "string" ? params.bindingId.trim() : ""
  if (!id) return { ok: false, reason: "not-found" }

  const binding = params.bindings.find((b) => b.id === id)
  if (!binding) return { ok: false, reason: "not-found" }
  if (!isConnectionKey(binding.connectionKey)) return { ok: false, reason: "not-allowlisted" }
  if (!params.configuredKeys.has(binding.connectionKey)) {
    return { ok: false, reason: "not-configured" }
  }
  const backed = params.identities.some(
    (i) => i.connectionKey === binding.connectionKey && i.userId === binding.auth0UserId,
  )
  if (!backed) return { ok: false, reason: "unbacked" }

  return { ok: true, binding }
}
