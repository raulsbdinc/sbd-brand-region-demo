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
  resolveEmailOwnership,
  isPasswordlessOnlyRecord,
  resolveResetBinding,
  sanitizeCredentialBindings,
  type EmailOwnershipCandidate,
  type CandidateAccount,
  type ConnectionKey,
  type CredentialBinding,
  type LinkedDbIdentity,
} from "@/lib/credential-model"
import {
  getUser,
  getUsersByEmail,
  searchUsersStrict,
  listUsersPage,
  isManagementConfigured,
  linkIdentity,
  type Auth0User,
} from "@/lib/auth0-management"
import {
  snapshotPasswordlessSubs,
  type PasswordlessStub,
} from "@/lib/brand-passcode-verify"
import {
  collectIdentityOwnedEmails,
  enumerateOwnershipCandidates,
  hydrateOwnershipCandidates,
  mapAddEmailGuardResponse,
  planAddEmailOwnership,
  type AddEmailCandidate,
  type AddEmailOwnershipDecision,
} from "@/lib/add-email-ownership"
import {
  planSharedLoginAlias,
  type LoginAliasCandidate,
  type SharedLoginAliasResolution,
} from "@/lib/login-alias"
import {
  detectCurrentBrandCredential,
  detectOtherBrandOnlyCredential,
  type BrandConnectionKey,
  type BrandDuplicateCandidate,
} from "@/lib/brand-duplicate"
import {
  accountModelSelectionAvailable,
  brandConnectionKey,
  planPerEmailRegistrationGuard,
  type PerEmailExistingFacts,
  type PerEmailGuardDecision,
} from "@/lib/account-model"
import {
  bareUserId,
  resolvePasswordChangeTarget,
  toManagementUserId,
  type PasswordChangeSelector,
} from "@/lib/password-change"
import { selectBrandPasscodeAccount } from "@/lib/brand-passcode-proof"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import type { BrandId, CountryId } from "@/lib/types"

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

/**
 * The canonical account a brand passcode sign-in should open, re-resolved
 * server-side AFTER the emailed code has been consumed. Returns the single
 * account enrolled in THIS storefront's brand for `email` (binding + backing
 * identity), or null — never an email-only match, never another brand.
 */
export async function resolveBrandPasscodeAccount(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
): Promise<string | null> {
  if (!isManagementConfigured()) return null
  if (siteBrand !== "dewalt" && siteBrand !== "stanley") return null
  const resolution = await resolveSigninCredential(email, siteBrand).catch(() => null)
  if (!resolution || resolution.kind !== "resolved" || resolution.connectionKey !== siteBrand) {
    return null
  }
  const { candidates: users, ok } = await gatherCandidates(email)
  if (!ok) return null
  return selectBrandPasscodeAccount({
    email,
    brandKey: siteBrand,
    candidates: users.map((user) => ({
      accountId: user.user_id ?? "",
      bindings: readBindings(user),
      identities: mapIdentities(user),
    })),
  })
}

/**
 * Every passwordless (`email|…`) account sub that exists for `email` RIGHT NOW.
 * Called before a brand passcode challenge is sent; null when the lookup fails
 * (verify then cannot prove any stub new and fails closed). Read-only.
 */
export async function snapshotPasswordlessSubsFor(email: string): Promise<string[] | null> {
  if (!isManagementConfigured()) return null
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  try {
    const users = await getUsersByEmail(normalized)
    return snapshotPasswordlessSubs(
      users.map((u) => ({
        userId: u.user_id ?? "",
        identities: (u.identities ?? []).map((id) => ({
          provider: id.provider,
          userId: String(id.user_id),
        })),
      })),
    )
  } catch {
    return null
  }
}

/** Read-only view of an account for the brand-passcode new-stub check. */
export async function readPasswordlessStub(sub: string): Promise<PasswordlessStub | null> {
  try {
    const user = await getUser(sub)
    return {
      userId: user.user_id ?? "",
      rootEmail: user.email ?? "",
      identities: (user.identities ?? []).map((id) => ({
        provider: id.provider,
        userId: String(id.user_id),
      })),
    }
  } catch {
    return null
  }
}

/** Link a provably-new passwordless identity under the brand canonical. */
export async function linkPasswordlessStub(canonical: string, stubUserId: string): Promise<void> {
  await linkIdentity(canonical, { provider: "email", user_id: stubUserId })
}

// --- Shared login-alias resolution (Model 2 verified alternate emails) ------

/** Discriminated result of resolving a typed email to a shared primary login. */
export type SharedLoginAliasResult =
  | SharedLoginAliasResolution
  | { kind: "unavailable" }

/**
 * Server bridge for Model 2: resolve a submitted email to the ONE primary
 * sbd-eu login email whose single shared password should be retried, using the
 * SAME shared connection name the rest of the credential architecture uses
 * (resolveConnectionNames().shared) — NOT a divergent per-deployment constant.
 * That divergence was the live defect: a verified alternate email never mapped
 * back to the primary shared identifier, so the shared-password retry was
 * skipped and Model 2 sign-in failed.
 *
 * Reuses gatherCandidates (root-email lookup + a search over the fields we
 * control), then defers the decision to the pure planner. Fails CLOSED:
 *   • Management not configured → "none" (no IO; cases 1 & 2 still sign in via
 *     the ordinary shared attempt with no Management call).
 *   • a lookup failed             → "unavailable" (incomplete set; no retry).
 *   • not a verified alias/root of a shared-backed account → "none".
 *   • more than one owning account → "ambiguous".
 * NEVER creates a second password or identity — this only picks which existing
 * shared username to authenticate.
 */
export async function resolveSharedLoginAlias(
  email: string,
): Promise<SharedLoginAliasResult> {
  if (!isManagementConfigured()) return { kind: "none" }

  const { candidates: users, ok } = await gatherCandidates(email)
  if (!ok) return { kind: "unavailable" }

  const names = resolveConnectionNames()
  const candidates: LoginAliasCandidate[] = users.map((user) => ({
    userId: user.user_id ?? "",
    rootEmail: user.email ?? "",
    rootEmailVerified: user.email_verified === true,
    sharedIdentityConnections: (user.identities ?? [])
      .filter((id) => id.provider === "auth0")
      .map((id) => id.connection)
      .filter((c): c is string => typeof c === "string"),
    aliasEmails: Array.isArray(user.app_metadata?.login_alias_emails)
      ? (user.app_metadata!.login_alias_emails as unknown[]).filter(
          (e): e is string => typeof e === "string",
        )
      : [],
  }))

  return planSharedLoginAlias({
    typedEmail: email,
    sharedConnectionName: names.shared,
    candidates,
  })
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

// --- Existing-account resolution (Model 4 cross-brand + duplicate guards) ---

export interface ExistingAccountRef {
  auth0UserId: string
  bindings: CredentialBinding[]
  /** The account's verified/owned emails (for a same-mailbox proof choice). */
  verifiedEmails: string[]
}

/**
 * Resolve THE single existing account that OWNS a submitted email on this
 * storefront, as a discriminated result the cross-brand link + Google flows use
 * to decide "first registration" vs "prove ownership then link":
 *   • "configured-off" → Management API absent; caller degrades gracefully.
 *   • "unavailable"    → a lookup failed, so absence of an account can't be
 *                        proven; the caller MUST fail closed.
 *   • "none"           → no account owns the email → a first registration.
 *   • "ambiguous"      → more than one account owns it → fail closed (never pick).
 *   • "single"         → exactly one owning account (its id + bindings).
 *
 * "Owns" means a candidate whose normalized ROOT email equals the submitted
 * email, or that carries a credential binding for it — the same trusted signals
 * the sign-in resolver validates against. Never trusts a browser-supplied id.
 */
export type ExistingAccountResolution =
  | { kind: "configured-off" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "single"; account: ExistingAccountRef }

export async function resolveExistingAccountByEmail(
  email: string,
  options?: {
    /**
     * A source identity (`user_id`) that must NEVER be counted as a candidate
     * TARGET owner of the email. Used by the cold-Google reconcile flow to
     * exclude the transient standalone google-oauth2 user Auth0 just minted:
     * that record's own root email IS the looked-up address, so without this it
     * inflates a single real alias owner into a false "ambiguous".
     */
    excludeUserId?: string
  },
): Promise<ExistingAccountResolution> {
  if (!isManagementConfigured()) return { kind: "configured-off" }

  const normalized = normalizeEmail(email)
  if (!normalized) return { kind: "none" }

  const { candidates, ok } = await gatherCandidates(email)
  if (!ok) return { kind: "unavailable" }

  // De-dupe by user_id (the two lookups can return the same record twice), then
  // hand the pure resolver each account's trusted ownership signals: its root
  // email, credential-binding emails, and VERIFIED alternate emails (linked
  // identity verified email or persisted login alias — what a Model 2 Gmail
  // alternate is). The pure core excludes the source identity and decides how
  // many DISTINCT accounts own the email.
  const byId = new Map<string, Auth0User>()
  for (const u of candidates) if (u.user_id) byId.set(u.user_id, u)

  const ownershipCandidates: EmailOwnershipCandidate[] = [...byId.values()].map(
    (user) => ({
      userId: user.user_id!,
      ownedEmails: [
        normalizeEmail(user.email),
        ...readBindings(user).map((b) => normalizeEmail(b.email)),
        ...collectAccountVerifiedEmails(user),
      ].filter((e) => e.length > 0),
      passwordlessOnly: isPasswordlessOnlyRecord({
        identityProviders: (user.identities ?? []).map((i) => i.provider ?? ""),
        bindingCount: readBindings(user).length,
      }),
    }),
  )

  const owners = resolveEmailOwnership({
    email: normalized,
    candidates: ownershipCandidates,
    excludeUserId: options?.excludeUserId,
  })

  if (owners.kind === "none") return { kind: "none" }
  if (owners.kind === "ambiguous") return { kind: "ambiguous" }

  const user = byId.get(owners.userId)!
  return {
    kind: "single",
    account: {
      auth0UserId: user.user_id!,
      bindings: readBindings(user),
      verifiedEmails: collectAccountVerifiedEmails(user),
    },
  }
}

// --- Model 3 pre-provision cross-brand / duplicate guard --------------------

/**
 * Server bridge that answers "may a per-email (Model 3) sign-up mint a user for
 * this email, on THIS storefront brand?" It resolves the single existing account
 * that owns the email (the same trusted signals the sign-in resolver validates
 * against) and defers the DECISION to the pure planner. It never mints anything
 * and never reveals which account matched — it only classifies the sign-up:
 *
 *   • proceed            → no account owns the email → the create route mints.
 *   • divert-cross-brand → the email already owns the OTHER UK brand → the create
 *                          route must NOT mint a per-email user; the client is
 *                          steered into the existing cross-brand proof flow so
 *                          this becomes a second brand password on that account.
 *   • already-registered → an account already owns this email here → sign in.
 *   • not-configured     → Management absent → Demo behaviour.
 *   • fail-closed        → ambiguous / unavailable / incoherent → refuse.
 *
 * `siteBrand` defaults to this deployment's brand and is overridable for tests.
 */
export async function resolvePerEmailRegistrationGuard(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
): Promise<PerEmailGuardDecision> {
  const existing = await resolveExistingAccountByEmail(email)
  const thisBrandKey = brandConnectionKey(siteBrand)
  const normalized = normalizeEmail(email)

  let facts: PerEmailExistingFacts
  switch (existing.kind) {
    case "configured-off":
      facts = { kind: "configured-off" }
      break
    case "unavailable":
      facts = { kind: "unavailable" }
      break
    case "ambiguous":
      facts = { kind: "ambiguous" }
      break
    case "none":
      facts = { kind: "none" }
      break
    case "single":
      facts = {
        kind: "single",
        bindings: existing.account.bindings,
        sameMailboxVerified: existing.account.verifiedEmails.some(
          (e) => e.toLowerCase() === normalized,
        ),
      }
      break
  }

  return planPerEmailRegistrationGuard({ existing: facts, thisBrandKey })
}

// --- Add-another-email canonical ownership guard ---------------------------

/**
 * Decide whether the signed-in `currentUserId` may add `email` to their account,
 * AFTER the emailed one-time code has proven mailbox control. Resolves every
 * account that provably owns the normalized email — each already canonical
 * because `getUsersByEmail`/the alias search return top-level records only — and
 * defers to the pure planner. Bare passwordless (`email`/`sms`) OTP stubs minted
 * by the code step are filtered so they never masquerade as a foreign owner.
 *
 * Fails CLOSED: Management not configured, or a directory lookup failed, both
 * return "unavailable" (the guard is only reached from a Management-guarded
 * route, so configured-off should not occur in practice). Runs post-verification
 * only, so it is never an enumeration oracle.
 */
export async function resolveAddEmailOwnership(
  email: string,
  currentUserId: string,
): Promise<AddEmailOwnershipDecision> {
  if (!isManagementConfigured()) return { ok: false, reason: "unavailable" }

  const normalized = normalizeEmail(email)
  const { candidates, ok } = await enumerateAddEmailCandidates()

  return planAddEmailOwnership({ email: normalized, currentUserId, candidates, lookupOk: ok })
}

/** Per-page size and page budget for the add-email ownership enumeration. */
const ADD_EMAIL_ENUM_PER_PAGE = 100
// 100 * 20 = 2000 covers a small demo tenant with margin. Auth0 caps this
// endpoint's deep pagination near 1000 records; a directory larger than the
// budget cannot be fully read, so enumeration reports ok=false and the guard
// fails CLOSED (reject) rather than risk missing a foreign owner.
const ADD_EMAIL_ENUM_MAX_PAGES = 20
// One user at a time. Five at once exceeds the UK tenant's Management API burst
// and the 429s fail the whole ownership guard closed, so a proven mailbox cannot
// be added. mgmtFetch retries a 429, and a single in-flight read stays inside
// the burst that previously succeeded.
const ADD_EMAIL_HYDRATION_CONCURRENCY = 1

/**
 * Candidate gather for the add-another-email OWNERSHIP guard. Two deterministic
 * phases against the Management API — NOT the v3 indexed search, which on this
 * tenant does not surface a linked SOCIAL identity's `profileData.email` (the
 * exact gap that let a foreign account's linked Gmail be added to a second
 * account):
 *
 *   1. ENUMERATE every user id by paginating the whole directory. The list
 *      payload's identity `profileData` is NOT trusted here — the `GET /users`
 *      records omit `identities[].profileData.email` on this tenant — so only the
 *      user id is taken from the list.
 *   2. HYDRATE every enumerated id with `getUser(id)` (`GET /users/{id}`, which
 *      DOES return identity `profileData`) under bounded concurrency, and reduce
 *      each hydrated record to its OWNERSHIP set:
 *        • every identity's email — a database identity's email AND a social
 *          identity's `profileData.email` (linked Google), via
 *          collectIdentityOwnedEmails,
 *        • credential-binding emails,
 *        • persisted verified aliases,
 *      all normalized. A bare passwordless (`email`/`sms`) OTP stub is flagged so
 *      it never counts as an owner.
 *
 * `ok` is false — so the ownership guard fails CLOSED (reject) — when either the
 * enumeration could not read the whole directory (a page error, an inconsistent
 * empty page, or truncation past the page budget) OR any per-user hydration threw
 * / returned a mismatched id. Never throws.
 */
async function enumerateAddEmailCandidates(): Promise<{
  candidates: AddEmailCandidate[]
  ok: boolean
}> {
  // Phase 1: deterministically collect every user id. Do not read profileData
  // from the list payload — it is unreliable here.
  const enumeration = await enumerateOwnershipCandidates<Auth0User>({
    fetchPage: async (page, perPage) => {
      const res = await listUsersPage(page, perPage)
      return { users: res.users ?? [], total: res.total ?? 0 }
    },
    perPage: ADD_EMAIL_ENUM_PER_PAGE,
    maxPages: ADD_EMAIL_ENUM_MAX_PAGES,
    identify: (user) => user.user_id ?? "",
    toCandidate: (user) => ({
      userId: user.user_id!,
      ownedEmails: [],
      hasRealIdentity: false,
    }),
  })

  if (!enumeration.ok) return { candidates: enumeration.candidates, ok: false }

  // Phase 2: hydrate every enumerated id with a full per-user read so the identity
  // profileData (linked Google email) is actually present, then build ownership.
  return hydrateOwnershipCandidates<Auth0User>({
    userIds: enumeration.candidates.map((c) => c.userId),
    concurrency: ADD_EMAIL_HYDRATION_CONCURRENCY,
    fetchUser: (id) => getUser(id),
    identify: (user) => user.user_id ?? "",
    toCandidate: (user) => ({
      userId: user.user_id!,
      ownedEmails: [
        ...collectIdentityOwnedEmails(user),
        ...readBindings(user).map((b) => normalizeEmail(b.email)),
        ...collectAccountVerifiedEmails(user),
      ].filter((e) => e.length > 0),
      hasRealIdentity: (user.identities ?? []).some(
        (id) => id.provider !== "email" && id.provider !== "sms",
      ),
    }),
  })
}

/** The single decision every email-linking route must obey before linking. */
export type AddEmailGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * CENTRALIZED add-another-email ownership guard. This is the ONE gate every
 * OTP-proven email-linking route must call after mailbox control is proven and
 * BEFORE it links/creates any identity — so no path can diverge or bypass the
 * canonical-ownership rule (the exact class of bug where one route carried a
 * weaker `getUsersByEmail` check that could not see a foreign account's linked
 * social identity).
 *
 * It runs the deterministic enumerate+hydrate resolver and returns the neutral
 * customer copy + HTTP status the route should return verbatim. It is READ-ONLY:
 * a refusal never deletes, unlinks or transfers any record. Allow only when
 * every existing owner of the normalized address resolves to THIS account
 * (unowned, or the same canonical parent — the Model 4 cross-brand / retry case).
 */
export async function guardAddEmailOwnership(params: {
  email: string
  currentUserId: string
}): Promise<AddEmailGuardResult> {
  const ownership = await resolveAddEmailOwnership(
    params.email,
    params.currentUserId,
  )
  return mapAddEmailGuardResponse(ownership)
}

/**
 * Whether THIS storefront brand's sign-in already exists for `email` — the
 * deterministic, privacy-safe signal the UK Create Account route uses to guide a
 * current-brand duplicate back to Sign in instead of failing closed.
 *
 * Gathers the same trusted candidate set the other resolvers use, reduces each
 * to its owned emails + real identities, and defers the decision to the pure
 * detector. Deliberately conservative: only a candidate that BOTH owns the email
 * AND holds a real identity on `brandKey`'s connection counts. Fails SAFE to
 * `false` when Management is unconfigured or a lookup failed — the route's normal
 * (none/single/ambiguous) handling then applies — so this can only ever ADD
 * correct sign-in guidance, never suppress a needed create/link.
 */
export async function currentBrandCredentialExists(
  email: string,
  brandKey: BrandConnectionKey,
): Promise<boolean> {
  if (!isManagementConfigured()) return false

  const { candidates: users, ok } = await gatherCandidates(email)
  if (!ok) return false

  const candidates: BrandDuplicateCandidate[] = users.map((user) => ({
    ownedEmails: [
      normalizeEmail(user.email),
      ...readBindings(user).map((b) => normalizeEmail(b.email)),
      ...collectAccountVerifiedEmails(user),
    ].filter((e) => e.length > 0),
    identities: mapIdentities(user),
  }))

  return detectCurrentBrandCredential({ email, brandKey, candidates })
}

/**
 * CIAM-17 bridge: on a UK storefront, whether forgot-password for `email` would
 * find ONLY the sister brand's password (e.g. a Stanley-only account on DeWalt).
 * Fails SAFE to `false` (normal neutral recovery applies) outside the UK, when
 * Management is unconfigured, or when a lookup failed.
 */
export async function recoveryBrandNotSetUp(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
  market: CountryId = SITE_MARKET,
): Promise<boolean> {
  if (!accountModelSelectionAvailable(market)) return false
  if (siteBrand !== "dewalt" && siteBrand !== "stanley") return false
  if (!isManagementConfigured()) return false

  const { candidates: users, ok } = await gatherCandidates(email)
  if (!ok) return false

  const candidates: BrandDuplicateCandidate[] = users.map((user) => ({
    ownedEmails: [
      normalizeEmail(user.email),
      ...readBindings(user).map((b) => normalizeEmail(b.email)),
      ...collectAccountVerifiedEmails(user),
    ].filter((e) => e.length > 0),
    identities: mapIdentities(user),
  }))

  return detectOtherBrandOnlyCredential({ email, brandKey: siteBrand, candidates })
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

// --- In-site password CHANGE coordinates ------------------------------------

export interface ResolvedPasswordChangeTarget {
  connectionKey: ConnectionKey
  /** The password-realm NAME (for ROPG current-password verification). */
  connectionName: string
  /**
   * The connection's Auth0 id, when configured. Needed to relink a linked
   * secondary identity by reference after its standalone password PATCH; may be
   * undefined for the shared/root path (the direct PATCH never relinks).
   */
  connectionId?: string
  /**
   * Provider-LESS identity `user_id` (ownership matching only; e.g. "6a97…").
   * Never send to the Management API — use `managementUserId` for the PATCH.
   */
  auth0UserId: string
  /**
   * The id for the Management `PATCH /users/{id}` — ALWAYS the PRIMARY/ROOT
   * account user id (e.g. "auth0|6a97…"). A linked secondary identity has no
   * standalone Management user (PATCH → 404 inexistent_user), so Auth0 requires
   * patching the primary user with the `connection` property. This is the field
   * the update route must use.
   */
  managementUserId: string
  /** True when the target is a linked secondary (PATCH relies on `connection`). */
  isLinkedSecondary: boolean
  /** The exact email this credential authenticates with. */
  email: string
  /** Customer-facing credential label. */
  label: string
  /** Brand for a per-brand credential; undefined for shared / per-email. */
  brand?: BrandId
}

/**
 * Resolve the coordinates for an IN-SITE password change from the SIGNED-IN
 * primary account and a browser SELECTOR (never coordinates). Everything —
 * connection name, connection key, and the database identity user_id to PATCH —
 * is derived server-side from the account's own bindings + linked identities.
 *
 * Delegates the allow-listing / ownership / backing / configuration rules to the
 * pure planner (resolvePasswordChangeTarget), then translates the resolved key
 * to a connection NAME here. Returns null on ANY fail-closed outcome so the
 * route answers with a single neutral rejection (never revealing which rule
 * failed, nor whether a binding id exists). A social identity is unreachable:
 * the shared path only considers auth0 database identities and the binding path
 * requires a database binding.
 */
export function resolvePasswordChangeCoordinates(
  primaryUser: Auth0User,
  selector: PasswordChangeSelector,
): ResolvedPasswordChangeTarget | null {
  const names = resolveConnectionNames()
  const ids = resolveConnectionIds()
  const configuredKeys = configuredConnectionKeys(names)

  const resolution = resolvePasswordChangeTarget({
    selector,
    bindings: readBindings(primaryUser),
    identities: mapIdentities(primaryUser),
    configuredKeys,
    rootEmail: primaryUser.email ?? "",
    // The PATCH always targets the primary/root account user; a linked secondary
    // identity is reached via the `connection` property, never its own user id.
    rootUserId: primaryUser.user_id ?? "",
  })
  if (!resolution.ok) return null

  const { target } = resolution
  const connectionName = names[target.connectionKey]
  if (!connectionName) return null
  // Fail closed if we somehow lack a root id to PATCH (never PATCH a blank id).
  if (!target.managementUserId) return null

  return {
    connectionKey: target.connectionKey,
    connectionName,
    connectionId: ids[target.connectionKey],
    auth0UserId: target.auth0UserId,
    managementUserId: target.managementUserId,
    isLinkedSecondary: target.isLinkedSecondary,
    email: target.email,
    label: target.label,
    brand: target.brand,
  }
}

// --- Unauthenticated RECOVERY reset coordinates -----------------------------

/**
 * Resolve the EXACT database credential an unauthenticated "forgot password"
 * reset must rewrite, from a submitted email + this deployment's SITE_BRAND —
 * the SAME resolution the sign-in path uses, so the credential reset is the one
 * that email would authenticate with:
 *
 *   • Model 3 (per-email): the address entered maps to its own per-email
 *     identity → reset ONLY that identity (never the other email's password).
 *   • Model 4 (per-brand): SITE_BRAND steers it to the current brand's identity
 *     → reset ONLY this brand's password (never the other brand's).
 *   • Models 1/2 (shared): the account's single shared identity.
 *
 * Ownership is proven out-of-band by a single-use emailed passcode BEFORE this
 * is called; this function only decides WHICH identity to rewrite. It returns
 * the same coordinates as an in-site change (so the shared executor + rollback
 * apply verbatim), or null on ANY fail-closed outcome (not configured, a failed
 * lookup, ambiguity, or no owned/backed identity) — the route then answers with
 * a single neutral rejection that never reveals whether the email exists.
 */
export async function resolveRecoveryTarget(
  email: string,
  siteBrand: BrandId = SITE_BRAND,
): Promise<ResolvedPasswordChangeTarget | null> {
  if (!isManagementConfigured()) return null

  const normalized = normalizeEmail(email)
  if (!normalized) return null

  const { candidates: users, ok } = await gatherCandidates(email)
  // An incomplete candidate set cannot prove which identity (or whether a
  // collision) — fail closed so recovery never rewrites the wrong credential.
  if (!ok) return null

  const names = resolveConnectionNames()
  const ids = resolveConnectionIds()
  const configuredKeys = configuredConnectionKeys(names)
  const sharedMatchIds = computeSharedMatchAccountIds(users, normalized, names.shared)

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

  // Ambiguous / not-configured → no safe single target.
  if (!resolution.ok) return null

  if (resolution.kind === "shared-default") {
    // Shared reset: require EXACTLY one account that genuinely owns this email
    // as a shared login and holds a real shared identity.
    if (!configuredKeys.has("shared")) return null
    if (sharedMatchIds.size !== 1) return null
    const [ownerId] = [...sharedMatchIds]
    const owner = users.find((u) => u.user_id === ownerId)
    if (!owner) return null
    const sharedIdentities = mapIdentities(owner).filter(
      (i) => i.connectionKey === "shared" && Boolean(i.userId),
    )
    if (sharedIdentities.length !== 1) return null
    const connectionName = names.shared
    if (!connectionName) return null
    const rootUserId = owner.user_id ?? ""
    if (!rootUserId) return null
    return {
      connectionKey: "shared",
      connectionName,
      connectionId: ids.shared,
      auth0UserId: sharedIdentities[0].userId,
      managementUserId: toManagementUserId(rootUserId),
      isLinkedSecondary:
        bareUserId(sharedIdentities[0].userId) !== bareUserId(rootUserId),
      email: normalizeEmail(owner.email) || normalized,
      label: CONNECTION_KEY_META.shared.label,
    }
  }

  // Resolved non-shared realm (per-email / per-brand). The binding carries the
  // exact database identity to rewrite; find the account that OWNS it.
  const { binding } = resolution
  if (!binding || !binding.auth0UserId) return null
  const connectionName = names[resolution.connectionKey]
  const connectionId = ids[resolution.connectionKey]
  if (!connectionName) return null

  const targetBare = bareUserId(binding.auth0UserId)
  const owner = users.find((user) =>
    mapIdentities(user).some((i) => bareUserId(i.userId) === targetBare),
  )
  if (!owner || !owner.user_id) return null

  const brand =
    resolution.connectionKey === "dewalt" || resolution.connectionKey === "stanley"
      ? (resolution.connectionKey as BrandId)
      : binding.brand

  return {
    connectionKey: resolution.connectionKey,
    connectionName,
    connectionId,
    auth0UserId: binding.auth0UserId,
    managementUserId: toManagementUserId(owner.user_id),
    isLinkedSecondary: targetBare !== bareUserId(owner.user_id),
    email: binding.email || normalized,
    label: CONNECTION_KEY_META[resolution.connectionKey].label,
    brand,
  }
}
