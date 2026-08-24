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

export interface ResolvedSigninCredential {
  connectionKey: ConnectionKey
  connectionName: string
  binding: CredentialBinding | null
}

/**
 * Resolve the database connection to authenticate a submitted email against on
 * THIS storefront. Returns null when nothing resolves, the connection name is
 * missing, or the resolution is ambiguous — every null collapses to the same
 * neutral failure upstream (no enumeration). `siteBrand` defaults to this
 * deployment's brand and is overridable only for tests/tooling.
 */
export async function resolveSigninCredential(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
): Promise<ResolvedSigninCredential | null> {
  if (!isManagementConfigured()) return null

  const candidates = await gatherCandidates(email)
  const bindings: CredentialBinding[] = []
  const identities: LinkedDbIdentity[] = []
  for (const user of candidates) {
    bindings.push(...readBindings(user))
    identities.push(...mapIdentities(user))
  }

  const names = resolveConnectionNames()
  const configuredKeys = configuredConnectionKeys(names)

  const resolution = resolveCredential({
    email,
    siteBrand,
    bindings,
    identities,
    configuredKeys,
  })
  if (!resolution.ok) return null

  const connectionName = names[resolution.connectionKey]
  if (!connectionName) return null

  return {
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
