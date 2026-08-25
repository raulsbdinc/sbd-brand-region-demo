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
  CONNECTION_KEY_META,
  configuredConnectionKeys,
  connectionKeyForName,
  normalizeEmail,
  resolveConnectionIds,
  resolveConnectionNames,
  resolveCredential,
  resolveResetBinding,
  sanitizeCredentialBindings,
  type ConnectionKey,
  type CredentialBinding,
  type LinkedDbIdentity,
} from "@/lib/credential-model"
import {
  getUsersByEmail,
  searchUsers,
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
 * seeded credential-binding emails). Mirrors the alias resolver's defensive
 * approach; returns [] and never throws on any lookup failure.
 */
async function gatherCandidates(email: string): Promise<Auth0User[]> {
  const typed = email.toLowerCase()
  const q = luceneEscapePhrase(typed)
  const query = `app_metadata.login_alias_emails:"${q}" OR app_metadata.credential_bindings.email:"${q}" OR email:"${q}"`
  const [byEmail, bySearch] = await Promise.all([
    getUsersByEmail(typed).catch(() => [] as Auth0User[]),
    searchUsers(query).catch(() => [] as Auth0User[]),
  ])
  const seen = new Set<string>()
  const out: Auth0User[] = []
  for (const u of [...byEmail, ...bySearch]) {
    if (!u?.user_id || seen.has(u.user_id)) continue
    seen.add(u.user_id)
    out.push(u)
  }
  return out
}

/**
 * Whether the submitted email is a GENUINE shared-connection login: the root
 * email or a persisted login alias (or a coherent shared binding email) of a
 * candidate account that ACTUALLY holds a shared-connection identity. This is
 * the "validate the shared match against the actual shared identity" step — a
 * login_alias or root email only counts when the account truly has a shared
 * identity, so a stray alias can never fabricate a shared match.
 */
function computeSharedMatch(
  candidates: Auth0User[],
  email: string,
  sharedConnectionName: string | undefined,
): boolean {
  if (!sharedConnectionName) return false
  for (const user of candidates) {
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
      return true
    }
  }
  return false
}

// Discriminated sign-in resolution so callers can distinguish a resolved
// non-shared realm, a shared-default attempt, and an ambiguous email that must
// NOT trigger any realm attempt.
export type SigninCredentialResolution =
  | {
      kind: "resolved"
      connectionKey: ConnectionKey
      connectionName: string
      binding: CredentialBinding | null
    }
  | { kind: "shared-default" }
  | { kind: "ambiguous" }

/**
 * Resolve the database connection to authenticate a submitted email against on
 * THIS storefront, as a DISCRIMINATED result:
 *   • "resolved"       → attempt ONLY the returned non-shared realm.
 *   • "shared-default" → make the ordinary shared attempt (cases 1 & 2, and
 *                        unknown emails — a neutral shared attempt is fine).
 *   • "ambiguous"      → the email collides across credentials; the caller MUST
 *                        fail closed and attempt NO realm.
 * Management-not-configured collapses to "shared-default" so cases 1 & 2 keep
 * working with no Management API. `siteBrand` defaults to this deployment's
 * brand and is overridable only for tests/tooling.
 */
export async function resolveSigninCredential(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
): Promise<SigninCredentialResolution> {
  if (!isManagementConfigured()) return { kind: "shared-default" }

  const normalized = normalizeEmail(email)
  const candidates = await gatherCandidates(email)
  const bindings: CredentialBinding[] = []
  const identities: LinkedDbIdentity[] = []
  for (const user of candidates) {
    bindings.push(...readBindings(user))
    identities.push(...mapIdentities(user))
  }

  const names = resolveConnectionNames()
  const configuredKeys = configuredConnectionKeys(names)
  const sharedMatch = computeSharedMatch(candidates, normalized, names.shared)

  const resolution = resolveCredential({
    email,
    siteBrand,
    bindings,
    identities,
    configuredKeys,
    sharedMatch,
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
