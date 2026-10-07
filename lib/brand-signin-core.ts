// Brand sign-in core (CIAM-20/21): the decision half of the server resolver and
// the password route, kept free of server-only imports so it runs against real
// Auth0-shaped records in unit tests. The server bridge only gathers records.

import {
  CONNECTION_KEY_META,
  configuredConnectionKeys,
  connectionKeyForName,
  normalizeEmail,
  resolveCredentialFromCandidates,
  sanitizeCredentialBindings,
  signinResolutionPermitsRealmOperation,
  verifiedLoginEmailsFor,
  type CandidateAccount,
  type ConnectionKey,
  type CredentialBinding,
  type LinkedDbIdentity,
} from "./credential-model.ts"
import { signinFailureResponse, type PasswordGrantOutcome } from "./password-grant-core.ts"
import { bareUserId, toManagementUserId } from "./password-change.ts"
import type { BrandId } from "./types"

/** The subset of an Auth0 Management user record this core reads. */
export interface SigninUserRecord {
  user_id?: string
  email?: string
  email_verified?: boolean
  identities?: {
    provider: string
    connection?: string
    user_id: string | number
    profileData?: { email?: unknown; email_verified?: unknown } & Record<string, unknown>
  }[]
  app_metadata?: Record<string, unknown>
}

export type ConnectionNames = Record<ConnectionKey, string | undefined>

export type SigninCredentialResolution =
  | {
      kind: "resolved"
      connectionKey: ConnectionKey
      connectionName: string
      binding: CredentialBinding | null
      /** The bound brand DB identity's own username, lowercased. */
      loginEmail: string
      /** The canonical account (Auth0 user_id) that owns that identity. */
      accountId: string
    }
  | { kind: "shared-default" }
  | { kind: "ambiguous" }
  | { kind: "unavailable" }

export function readUserBindings(user: SigninUserRecord): CredentialBinding[] {
  return sanitizeCredentialBindings(user.app_metadata?.credential_bindings)
}

function dbIdentitiesOf(user: SigninUserRecord, names: ConnectionNames): LinkedDbIdentity[] {
  return (user.identities ?? [])
    .filter((id) => id.provider === "auth0")
    .map((id) => ({
      connectionKey: connectionKeyForName(id.connection, names),
      userId: String(id.user_id),
    }))
}

/**
 * The emails this record proves it owns. Read ONLY from the record's root and
 * its currently linked identities; `app_metadata.login_alias_emails` is never
 * a source, so an unlinked (removed) email stops resolving even when the
 * best-effort alias-index cleanup did not run.
 */
export function verifiedLoginEmailsOfUser(user: SigninUserRecord): string[] {
  return verifiedLoginEmailsFor({
    rootEmail: user.email,
    rootEmailVerified: user.email_verified,
    bindingCount: readUserBindings(user).length,
    identities: (user.identities ?? []).map((id) => ({
      provider: id.provider,
      profileEmail: id.profileData?.email,
      profileEmailVerified: id.profileData?.email_verified,
    })),
  })
}

function sharedMatchAccountIds(
  users: SigninUserRecord[],
  email: string,
  sharedConnectionName: string | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!sharedConnectionName) return ids
  for (const user of users) {
    if (!user.user_id) continue
    const hasShared = (user.identities ?? []).some(
      (id) => id.provider === "auth0" && id.connection === sharedConnectionName,
    )
    if (!hasShared) continue
    const aliases = Array.isArray(user.app_metadata?.login_alias_emails)
      ? (user.app_metadata!.login_alias_emails as unknown[])
          .filter((e): e is string => typeof e === "string")
          .map(normalizeEmail)
      : []
    const sharedBindingEmails = readUserBindings(user)
      .filter((b) => b.connectionKey === "shared")
      .map((b) => b.email)
    if (
      normalizeEmail(user.email) === email ||
      aliases.includes(email) ||
      sharedBindingEmails.includes(email)
    ) {
      ids.add(user.user_id)
    }
  }
  return ids
}

/**
 * The username the brand's database connection actually holds for the bound
 * identity: the owner's root email when that identity IS the root, otherwise
 * the linked identity's own profile email. Falls back to the binding's stored
 * email only when the identity carries none. Never another brand's identity.
 */
export function brandIdentityLoginEmail(
  owner: SigninUserRecord,
  binding: CredentialBinding,
  names: ConnectionNames,
): string {
  const identity = (owner.identities ?? []).find(
    (id) =>
      id.provider === "auth0" &&
      connectionKeyForName(id.connection, names) === binding.connectionKey &&
      String(id.user_id) === binding.auth0UserId,
  )
  if (!identity) return ""
  const isRoot = owner.user_id === `auth0|${String(identity.user_id)}`
  const own = isRoot ? normalizeEmail(owner.email) : normalizeEmail(identity.profileData?.email)
  return own || normalizeEmail(binding.email)
}

/**
 * Decide the sign-in credential for `email` on `siteBrand` from a COMPLETE
 * candidate set (the caller maps a failed lookup to "unavailable" first).
 */
export function resolveSigninFromUsers(params: {
  email: string
  siteBrand: BrandId
  users: SigninUserRecord[]
  names: ConnectionNames
}): SigninCredentialResolution {
  const email = normalizeEmail(params.email)
  if (!email) return { kind: "shared-default" }
  const shared = sharedMatchAccountIds(params.users, email, params.names.shared)
  const candidates: CandidateAccount[] = params.users.map((user) => ({
    accountId: user.user_id ?? "",
    bindings: readUserBindings(user),
    identities: dbIdentitiesOf(user, params.names),
    sharedMatch: user.user_id ? shared.has(user.user_id) : false,
    verifiedLoginEmails: verifiedLoginEmailsOfUser(user),
  }))

  const resolution = resolveCredentialFromCandidates({
    email,
    siteBrand: params.siteBrand,
    candidates,
    configuredKeys: configuredConnectionKeys(params.names),
  })
  if (!resolution.ok) {
    return resolution.reason === "ambiguous" ? { kind: "ambiguous" } : { kind: "shared-default" }
  }
  if (resolution.kind === "shared-default") return { kind: "shared-default" }

  const connectionName = params.names[resolution.connectionKey]
  if (!connectionName || resolution.connectionKey === "shared") return { kind: "shared-default" }

  const binding = resolution.binding
  const owner = params.users.find((u) =>
    dbIdentitiesOf(u, params.names).some(
      (i) => i.connectionKey === binding.connectionKey && i.userId === binding.auth0UserId,
    ),
  )
  if (!owner?.user_id) return { kind: "shared-default" }
  const loginEmail = brandIdentityLoginEmail(owner, binding, params.names)
  if (!loginEmail) return { kind: "shared-default" }

  return {
    kind: "resolved",
    connectionKey: resolution.connectionKey,
    connectionName,
    binding,
    loginEmail,
    accountId: owner.user_id,
  }
}

/** The exact database identity an unauthenticated recovery reset rewrites. */
export interface RecoveryTargetCore {
  connectionKey: ConnectionKey
  connectionName: string
  connectionId?: string
  /** Provider-less user_id of the database identity to rewrite. */
  auth0UserId: string
  /** The canonical account to PATCH (a linked secondary is reached via `connection`). */
  managementUserId: string
  isLinkedSecondary: boolean
  /** The username that identity actually holds. */
  email: string
  label: string
  brand?: BrandId
}

/**
 * Decide which ONE password an unauthenticated "forgot password" may reset for
 * a mailbox-proven `email` on `siteBrand`. Uses the same candidate facts as
 * sign-in — including each record's verified login emails — so a verified
 * address of the canonical customer resets that customer's THIS-brand password
 * even when the brand was enrolled with their other address. Returns null on
 * ambiguity (distinct customers claim the email), no backed binding for this
 * brand, or an unconfigured realm; never another brand, never a fallback.
 */
export function resolveRecoveryFromUsers(params: {
  email: string
  siteBrand: BrandId
  users: SigninUserRecord[]
  names: ConnectionNames
  ids: Record<ConnectionKey, string | undefined>
}): RecoveryTargetCore | null {
  const { names, ids, users } = params
  const email = normalizeEmail(params.email)
  if (!email) return null

  const shared = sharedMatchAccountIds(users, email, names.shared)
  const configuredKeys = configuredConnectionKeys(names)
  const candidates: CandidateAccount[] = users.map((user) => ({
    accountId: user.user_id ?? "",
    bindings: readUserBindings(user),
    identities: dbIdentitiesOf(user, names),
    sharedMatch: user.user_id ? shared.has(user.user_id) : false,
    verifiedLoginEmails: verifiedLoginEmailsOfUser(user),
  }))
  const resolution = resolveCredentialFromCandidates({
    email,
    siteBrand: params.siteBrand,
    candidates,
    configuredKeys,
  })
  if (!resolution.ok) return null

  if (resolution.kind === "shared-default") {
    // Legacy shared reset (unchanged): exactly one owner holding one shared identity.
    if (!configuredKeys.has("shared") || shared.size !== 1) return null
    const [ownerId] = [...shared]
    const owner = users.find((u) => u.user_id === ownerId)
    if (!owner?.user_id || !names.shared) return null
    const sharedIds = dbIdentitiesOf(owner, names).filter(
      (i) => i.connectionKey === "shared" && Boolean(i.userId),
    )
    if (sharedIds.length !== 1) return null
    return {
      connectionKey: "shared",
      connectionName: names.shared,
      connectionId: ids.shared,
      auth0UserId: sharedIds[0].userId,
      managementUserId: toManagementUserId(owner.user_id),
      isLinkedSecondary: bareUserId(sharedIds[0].userId) !== bareUserId(owner.user_id),
      email: normalizeEmail(owner.email) || email,
      label: CONNECTION_KEY_META.shared.label,
    }
  }

  const { binding, connectionKey } = resolution
  if (!binding?.auth0UserId) return null
  const connectionName = names[connectionKey]
  if (!connectionName) return null

  // The owner is the account that holds THIS binding's identity on THIS realm.
  const owner = users.find((u) =>
    dbIdentitiesOf(u, names).some(
      (i) => i.connectionKey === connectionKey && i.userId === binding.auth0UserId,
    ),
  )
  if (!owner?.user_id) return null
  const loginEmail = brandIdentityLoginEmail(owner, binding, names)
  if (!loginEmail) return null

  return {
    connectionKey,
    connectionName,
    connectionId: ids[connectionKey],
    auth0UserId: binding.auth0UserId,
    managementUserId: toManagementUserId(owner.user_id),
    isLinkedSecondary: bareUserId(binding.auth0UserId) !== bareUserId(owner.user_id),
    email: loginEmail,
    label: CONNECTION_KEY_META[connectionKey].label,
    brand:
      connectionKey === "dewalt" || connectionKey === "stanley"
        ? (connectionKey as BrandId)
        : binding.brand,
  }
}

/** Decode a JWT payload without verifying (the token came server-to-server). */
export function decodeJwtClaims(idToken: string): Record<string, unknown> {
  try {
    const payload = idToken.split(".")[1]
    if (!payload) return {}
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Whether the subject Auth0 returned for the brand grant is the canonical owner
 * the resolver selected. Auth0 answers a grant on a LINKED secondary identity
 * with the primary (canonical) user's sub, and a root identity with its own
 * sub; both equal `accountId`, which the resolver only returns when that
 * account holds the bound brand identity. Any other sub (the identity was
 * unlinked or relinked since the lookup, or an unrelated user) is refused.
 */
export function grantSubjectMatchesOwner(sub: unknown, accountId: string): boolean {
  return typeof sub === "string" && sub.length > 0 && !!accountId && sub === accountId
}

export const SIGNIN_GENERIC_ERROR = "That email or password isn't right."

export type BrandPasswordSigninResult =
  | { kind: "session"; tokens: Extract<PasswordGrantOutcome, { kind: "ok" }>["tokens"]; claims: Record<string, unknown>; sub: string; connectionKey: ConnectionKey }
  | { kind: "failure"; status: number; body: Record<string, unknown>; headers?: Record<string, string> }

export interface BrandPasswordSigninDeps {
  resolve(email: string, opts: { deadlineAt: number }): Promise<SigninCredentialResolution>
  grant(args: { username: string; password: string; connectionKey: ConnectionKey; deadlineAt: number }): Promise<PasswordGrantOutcome>
  now(): number
}

/**
 * Resolve, then ONE password grant against the bound brand realm using that
 * brand identity's own username, then confirm the returned subject is the
 * selected canonical owner before any session may be minted.
 */
export async function runBrandPasswordSignin(
  input: { email: string; password: string; lookupBudgetMs: number; signinBudgetMs: number },
  deps: BrandPasswordSigninDeps,
): Promise<BrandPasswordSigninResult> {
  const generic = { kind: "failure", status: 401, body: { error: SIGNIN_GENERIC_ERROR } } as const
  const startedAt = deps.now()
  const resolution = await deps
    .resolve(input.email, { deadlineAt: startedAt + input.lookupBudgetMs })
    .catch((): SigninCredentialResolution => ({ kind: "unavailable" }))

  if (resolution.kind === "unavailable") {
    const f = signinFailureResponse("unavailable")
    return { kind: "failure", status: f.status, body: f.body, headers: f.headers }
  }
  if (!signinResolutionPermitsRealmOperation(resolution.kind) || resolution.kind !== "resolved") {
    return generic
  }

  const grant = await deps.grant({
    username: resolution.loginEmail,
    password: input.password,
    connectionKey: resolution.connectionKey,
    deadlineAt: startedAt + input.signinBudgetMs,
  })
  if (grant.kind !== "ok") {
    const f = signinFailureResponse(grant.kind, grant.kind === "throttled" ? grant.retryAfterSeconds : undefined)
    return { kind: "failure", status: f.status, body: f.body, headers: f.headers }
  }

  const claims = decodeJwtClaims(grant.tokens.id_token)
  if (!grantSubjectMatchesOwner(claims.sub, resolution.accountId)) return generic
  return {
    kind: "session",
    tokens: grant.tokens,
    claims,
    sub: claims.sub as string,
    connectionKey: resolution.connectionKey,
  }
}
