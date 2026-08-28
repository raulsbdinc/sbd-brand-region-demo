// SERVER-ONLY CREDENTIAL RESOLVER
// ===============================
// The server bridge between the pure model (lib/credential-model.ts) and Auth0.
// Given a submitted email + this deployment's SITE_BRAND it resolves exactly
// ONE database connection to authenticate against, and given a signed-in
// account it validates a credential-binding id before a password reset.
//
// The raw connection NAME (the password-realm `realm`) and connection ID (the
// Management-API reset/link value) never cross to the browser: callers hand us
// the internal ConnectionKey the pure resolver returned, and we translate it to
// the name/id here, server-side, from env.

import "server-only"
import {
  aggregateCandidateLookups,
  CONNECTION_KEY_META,
  configuredConnectionKeys,
  connectionKeyForName,
  normalizeEmail,
  resolveConnectionIds,
  resolveConnectionNames,
  resolveCredentialFromCandidates,
  resolveResetBinding,
  sanitizeCredentialBindings,
  type CandidateAccount,
  type ConnectionKey,
  type CredentialBinding,
  type LinkedDbIdentity,
} from "@/lib/credential-model"
import {
  getUsersByEmail,
  searchUsersStrict,
  isManagementConfigured,
  type Auth0User,
} from "@/lib/auth0-management"
import { SITE_BRAND } from "@/lib/site"
import type { BrandId } from "@/lib/types"

/** The connection NAME for a key (server-only). */
export function connectionNameForKey(key: ConnectionKey): string | undefined {
  return resolveConnectionNames()[key]
}

/** The Management-API connection ID for a key (server-only). */
export function connectionIdForKey(key: ConnectionKey): string | undefined {
  return resolveConnectionIds()[key]
}

/** Map one Auth0 user's identities to key-mapped database identities. */
function mapIdentities(user: Auth0User): LinkedDbIdentity[] {
  const names = resolveConnectionNames()
  return (user.identities ?? [])
    .filter((id) => id.provider === "auth0")
    .map((id) => ({
      connectionKey: connectionKeyForName(id.connection, names),
      userId: id.user_id,
    }))
}

/** Read a user's credential bindings from app_metadata (non-secret metadata). */
export function readBindings(user: Auth0User): CredentialBinding[] {
  return sanitizeCredentialBindings(user.app_metadata?.credential_bindings)
}

function luceneEscapePhrase(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Gather candidate account records for a submitted email: the direct root-email
 * lookup PLUS a search over the fields we control (persisted login aliases and
 * seeded credential-binding emails).
 *
 * Returns `{ ok }` alongside the candidates. `ok` is false when EITHER lookup
 * failed — an incomplete candidate set cannot prove that a case-3/4 credential
 * or a collision is absent, so the caller must fail CLOSED (never treat a failed
 * lookup as "no non-shared match"). Uses the STRICT search (which THROWS on a
 * Management error) — the neutral-empty `searchUsers` would hide a search
 * failure as an empty result and defeat the fail-closed path. Never throws.
 */
async function gatherCandidates(
  email: string,
): Promise<{ candidates: Auth0User[]; ok: boolean }> {
  const typed = email.toLowerCase()
  const q = luceneEscapePhrase(typed)
  const query = `app_metadata.login_alias_emails:"${q}" OR app_metadata.credential_bindings.email:"${q}" OR email:"${q}"`
  const results = await Promise.allSettled([
    getUsersByEmail(typed),
    searchUsersStrict(query),
  ])
  return aggregateCandidateLookups(results)
}

/**
 * The set of candidate account ids (`user_id`) for which the submitted email is
 * a GENUINE shared-connection login: the root email or a persisted login alias
 * (or a coherent shared binding email) of a candidate account that ACTUALLY
 * holds a shared-connection identity. This is the "validate the shared match
 * against the actual shared identity" step — a login_alias or root email only
 * counts when the account truly has a shared identity, so a stray alias can
 * never fabricate a shared match.
 *
 * Returning the OWNING account ids (not just a boolean) lets the pure resolver
 * distinguish a same-account scoped override from a cross-account collision.
 */
function computeSharedMatchAccountIds(
  candidates: Auth0User[],
  email: string,
  sharedConnectionName: string | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!sharedConnectionName) return ids
  for (const user of candidates) {
    if (!user.user_id) continue
    const hasSharedIdentity = (user.identities ?? []).some(
      (id) => id.provider === "auth0" && id.connection === sharedConnectionName,
    )
    if (!hasSharedIdentity) continue

    const rootEmail = normalizeEmail(user.email)
    const aliasList = Array.isArray(user.app_metadata?.login_alias_emails)
      ? (user.app_metadata!.login_alias_emails as unknown[])
          .filter((e): e is string => typeof e === "string")
          .map(normalizeEmail)
      : []
    const sharedBindingEmails = readBindings(user)
      .filter((b) => b.connectionKey === "shared")
      .map((b) => b.email)

    if (
      rootEmail === email ||
      aliasList.includes(email) ||
      sharedBindingEmails.includes(email)
    ) {
      ids.add(user.user_id)
    }
  }
  return ids
}

// Discriminated sign-in resolution so callers can distinguish a resolved
// non-shared realm, a shared-default attempt, an ambiguous email, and an
// unavailable lookup — the last two BOTH fail closed with no realm attempt.
export type SigninCredentialResolution =
  | {
      kind: "resolved"
      connectionKey: ConnectionKey
      connectionName: string
      binding: CredentialBinding | null
    }
  | { kind: "shared-default" }
  | { kind: "ambiguous" }
  | { kind: "unavailable" }

/**
 * Resolve the database connection to authenticate a submitted email against on
 * THIS storefront, as a DISCRIMINATED result:
 *   • "resolved"       → attempt ONLY the returned non-shared realm.
 *   • "shared-default" → make the ordinary shared attempt (cases 1 & 2, and
 *                        unknown emails — a neutral shared attempt is fine).
 *   • "ambiguous"      → the email collides across credentials; the caller MUST
 *                        fail closed and attempt NO realm.
 *   • "unavailable"    → a Management lookup failed while Management is
 *                        configured, so the candidate set is incomplete and
 *                        absence of a collision cannot be proven; the caller
 *                        MUST fail closed and attempt NO realm.
 * Management-not-configured collapses to "shared-default" so cases 1 & 2 keep
 * working with no Management API. `siteBrand` defaults to this deployment's
 * brand and is overridable only for tests/tooling.
 *
 * ACCOUNT OWNERSHIP: candidate records are passed to the pure resolver WITHOUT
 * flattening, so a binding on one account can only be validated by an identity
 * on that SAME account.
 */
export async function resolveSigninCredential(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
): Promise<SigninCredentialResolution> {
  if (!isManagementConfigured()) return { kind: "shared-default" }

  const normalized = normalizeEmail(email)
  const { candidates: users, ok } = await gatherCandidates(email)

  // Incomplete candidate set (a lookup failed while Management is configured):
  // we cannot prove a case-3/4 credential or collision is absent → fail closed.
  if (!ok) return { kind: "unavailable" }

  const names = resolveConnectionNames()
  const configuredKeys = configuredConnectionKeys(names)
  const sharedMatchIds = computeSharedMatchAccountIds(users, normalized, names.shared)

  // Preserve per-account ownership: each Auth0 record's bindings are paired ONLY
  // with that same record's identities — never cross-matched. `accountId` +
  // per-account `sharedMatch` let the pure resolver tell a same-account scoped
  // override (the normal Model 1/2 → scoped transition) apart from a real
  // cross-account collision.
  const candidates: CandidateAccount[] = users.map((user) => ({
    accountId: user.user_id ?? "",
    bindings: readBindings(user),
    identities: mapIdentities(user),
    sharedMatch: user.user_id ? sharedMatchIds.has(user.user_id) : false,
  }))

  const resolution = resolveCredentialFromCandidates({
    email,
    siteBrand,
    candidates,
    configuredKeys,
  })

  // Fail CLOSED on ambiguity — never attempt any realm. Any other non-ok
  // (not-configured) safely degrades to the ordinary shared attempt.
  if (!resolution.ok) {
    return resolution.reason === "ambiguous"
      ? { kind: "ambiguous" }
      : { kind: "shared-default" }
  }
  if (resolution.kind === "shared-default") return { kind: "shared-default" }

  const connectionName = names[resolution.connectionKey]
  if (!connectionName) return { kind: "shared-default" }

  return {
    kind: "resolved",
    connectionKey: resolution.connectionKey,
    connectionName,
    binding: resolution.binding,
  }
}

// --- Additional-password provisioning support -----------------------------

/**
 * The set of verified, OWNED emails on the primary account, derived ONLY from
 * trusted server-side sources — never from the browser:
 *   • the root email, when `email_verified`;
 *   • any linked identity's verified email (database or social), read from that
 *     identity's own `profileData`;
 *   • trusted persisted verified aliases in `app_metadata.login_alias_emails`
 *     (these are only ever written after a verification step).
 * All normalized + deduped. This is the ownership proof the provisioning model
 * relies on, so a UI-supplied email that is not in this set is rejected.
 */
export function collectAccountVerifiedEmails(primaryUser: Auth0User): string[] {
  const out = new Set<string>()

  const root = normalizeEmail(primaryUser.email)
  if (root && primaryUser.email_verified) out.add(root)

  for (const id of primaryUser.identities ?? []) {
    const pd = (id.profileData ?? {}) as Record<string, unknown>
    const email = normalizeEmail(pd.email)
    const verified = pd.email_verified === true || pd.email_verified === "true"
    if (email && verified) out.add(email)
  }

  const aliases = primaryUser.app_metadata?.login_alias_emails
  if (Array.isArray(aliases)) {
    for (const a of aliases) {
      const email = normalizeEmail(a)
      if (email) out.add(email)
    }
  }

  return [...out]
}

/** The connection keys that have a configured connection NAME (server-only). */
export function configuredConnectionKeySet(): ReadonlySet<ConnectionKey> {
  return configuredConnectionKeys(resolveConnectionNames())
}

/**
 * The primary account's normalized root email (used as the "this-brand" target).
 * Empty string when absent.
 */
export function primaryAccountEmail(primaryUser: Auth0User): string {
  return normalizeEmail(primaryUser.email)
}

export interface ResolvedResetTarget {
  binding: CredentialBinding
  connectionId: string
  connectionName: string
  email: string
  label: string
}

/**
 * Validate a credential-binding id against the SIGNED-IN primary account and
 * return the coordinates a Management-API password-change ticket needs
 * (connection_id + email). Returns null when the id is unknown, not backed by a
 * real linked identity, or its connection id is not configured — the reset
 * route then falls back to the primary shared credential or a neutral error.
 */
export function resolveResetTarget(
  primaryUser: Auth0User,
  bindingId: string,
): ResolvedResetTarget | null {
  const names = resolveConnectionNames()
  const ids = resolveConnectionIds()
  const configuredKeys = configuredConnectionKeys(names)

  const resolution = resolveResetBinding({
    bindingId,
    bindings: readBindings(primaryUser),
    identities: mapIdentities(primaryUser),
    configuredKeys,
  })
  if (!resolution.ok) return null

  const { binding } = resolution
  const connectionId = ids[binding.connectionKey]
  const connectionName = names[binding.connectionKey]
  if (!connectionId || !connectionName) return null

  return {
    binding,
    connectionId,
    connectionName,
    email: binding.email,
    label: CONNECTION_KEY_META[binding.connectionKey].label,
  }
}
