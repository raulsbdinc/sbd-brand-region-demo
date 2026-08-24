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

const BRAND_IDS: ReadonlySet<string> = new Set<BrandId>(["dewalt", "craftsman", "stanley"])

/**
 * Read one raw binding-ish value into a valid CredentialBinding, or null when
 * it is malformed or carries an unknown (non-allow-listed) connection key /
 * use case. Never throws — junk is silently dropped.
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

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${connectionKey}:${auth0UserId}`

  const brand =
    typeof raw.brand === "string" && BRAND_IDS.has(raw.brand)
      ? (raw.brand as BrandId)
      : CONNECTION_KEY_META[connectionKey].brand

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

export type CredentialResolution =
  | { ok: true; connectionKey: ConnectionKey; binding: CredentialBinding | null }
  | { ok: false; reason: "no-match" | "ambiguous" | "not-configured" | "brand-restricted" }

export interface ResolveCredentialParams {
  email: string
  siteBrand: BrandId
  /** Bindings gathered from the candidate account(s)' app_metadata. */
  bindings: CredentialBinding[]
  /** The candidate account(s)' actual linked database identities. */
  identities: LinkedDbIdentity[]
  /** Connection keys that have a configured connection name. */
  configuredKeys: ReadonlySet<ConnectionKey>
}

/**
 * Resolve exactly ONE database connection key for a submitted email on this
 * storefront, failing CLOSED on anything ambiguous.
 *
 * Rules:
 *   • A non-shared binding counts only when it is allow-listed, its connection
 *     is configured, it is permitted on SITE_BRAND, AND it is backed by a real
 *     linked identity on that connection (metadata validated against identities).
 *   • Exactly one such binding → that connection (case 3 / case 4).
 *   • More than one → AMBIGUOUS, fail closed (neutral error upstream).
 *   • None → the shared connection (root users and login aliases — cases 1 & 2,
 *     unchanged) when it is configured; otherwise not-configured.
 */
export function resolveCredential(params: ResolveCredentialParams): CredentialResolution {
  const email = normalizeEmail(params.email)

  const matches: CredentialBinding[] = []
  const seen = new Set<string>()
  for (const b of params.bindings) {
    if (normalizeEmail(b.email) !== email) continue
    if (!isConnectionKey(b.connectionKey)) continue
    if (b.connectionKey === "shared") continue // shared is the default, below
    if (!params.configuredKeys.has(b.connectionKey)) continue
    if (!isBrandAllowed(b.connectionKey, params.siteBrand)) continue
    const backed = params.identities.some(
      (i) => i.connectionKey === b.connectionKey && i.userId === b.auth0UserId,
    )
    if (!backed) continue
    const dedupeKey = `${b.connectionKey}|${b.auth0UserId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    matches.push(b)
  }

  if (matches.length === 1) {
    return { ok: true, connectionKey: matches[0].connectionKey, binding: matches[0] }
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" }
  }

  // No routable per-email/per-brand credential: fall through to the shared
  // connection exactly as today (root user or login alias, cases 1 & 2).
  if (params.configuredKeys.has("shared")) {
    return { ok: true, connectionKey: "shared", binding: null }
  }
  return { ok: false, reason: "not-configured" }
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
