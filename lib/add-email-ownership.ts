// ADD-EMAIL CANONICAL OWNERSHIP GUARD — PURE
// ==========================================
// When an authenticated customer adds ANOTHER email address to their account
// (Model 3 completion / "Add another email"), the address they type may already
// belong to a DIFFERENT canonical customer. Linking it anyway would silently
// attach a second person's mailbox to this account. This module is the pure,
// framework-free decision for whether an ownership-proven add may proceed.
//
// The rule (fail CLOSED):
//   • Resolve EVERY account that provably owns the normalized email, each mapped
//     to its CANONICAL parent user id (a linked identity resolves to the primary
//     it is linked under — never to itself).
//   • ALLOW only when every existing owner resolves to the CURRENT canonical
//     user (i.e. the email is unowned, or already owned by this same account —
//     the Model 4 cross-brand / partial-retry case).
//   • REJECT when any owner is a different canonical customer ("different-owner")
//     or when ownership cannot be determined ("ambiguous"/"unavailable").
//
// This runs AFTER the emailed one-time code has proven mailbox control, so it is
// never an enumeration oracle: a customer only reaches it for an address they
// just demonstrated they can receive mail at. It intentionally makes NO Auth0
// calls itself — the server bridge supplies the already-resolved owner set.

import { normalizeEmail } from "./credential-model.ts"

/**
 * One provable owner of the submitted email, already reduced by the caller to
 * its CANONICAL parent account id. For a standalone account this is its own
 * `user_id`; for a linked identity it is the primary `user_id` it is linked
 * under. The caller is responsible for the canonical mapping — this pure core
 * only compares canonical ids.
 */
export interface CanonicalOwner {
  /** The canonical (primary) Auth0 user id that ultimately owns this email. */
  canonicalUserId: string
}

export type AddEmailOwnershipDecision =
  | { ok: true }
  | { ok: false; reason: "different-owner" | "ambiguous" | "unavailable" }

/**
 * Decide whether `currentUserId` may add `email`, given the fully-resolved set
 * of canonical owners and whether that resolution is trustworthy/complete.
 *
 *   • `lookupOk === false` → a directory lookup failed; absence of a foreign
 *     owner cannot be proven, so fail closed as "unavailable".
 *   • no owners            → unowned, ALLOW.
 *   • all owners are the current canonical user → ALLOW (same-account
 *     Model 4 cross-brand / idempotent retry).
 *   • any owner is a different canonical user → REJECT "different-owner".
 *   • the current user is among the owners but so is someone else, OR the owner
 *     set is otherwise not uniquely this account → REJECT (ambiguous/different).
 */
export function evaluateAddEmailOwnership(params: {
  email: string
  currentUserId: string
  owners: CanonicalOwner[]
  lookupOk: boolean
}): AddEmailOwnershipDecision {
  const normalized = normalizeEmail(params.email)
  if (!normalized) return { ok: false, reason: "unavailable" }
  if (!params.currentUserId) return { ok: false, reason: "unavailable" }
  if (!params.lookupOk) return { ok: false, reason: "unavailable" }

  const distinct = new Set<string>()
  for (const owner of params.owners) {
    const id = owner.canonicalUserId?.trim()
    if (!id) {
      // An owner we could not map to a canonical parent means we cannot prove
      // it is this account — fail closed rather than guess.
      return { ok: false, reason: "ambiguous" }
    }
    distinct.add(id)
  }

  if (distinct.size === 0) return { ok: true }
  if (distinct.size === 1 && distinct.has(params.currentUserId)) return { ok: true }
  // Every remaining shape includes at least one foreign canonical owner.
  return { ok: false, reason: "different-owner" }
}

/**
 * One raw candidate account (a TOP-LEVEL Auth0 record) the server bridge gathered
 * for the submitted email. `getUsersByEmail` + the alias/binding search return
 * top-level records only — Auth0 collapses linked identities under their primary,
 * so a top-level record IS its own canonical parent. The reduction below maps
 * each owning real account to a `CanonicalOwner`.
 */
export interface AddEmailCandidate {
  /** Top-level (canonical) Auth0 user id. */
  userId: string
  /** Every normalized email this account provably owns: root + binding + verified alias. */
  ownedEmails: string[]
  /**
   * True when the account holds at least one REAL identity (a database `auth0`
   * or social identity), i.e. it is a genuine account — NOT a bare passwordless
   * (`email`/`sms`) OTP stub. A stub minted by the emailed-code step must never
   * count as an owner, or a legitimate add to an unowned address would be
   * rejected against the flow's own transient artifact.
   */
  hasRealIdentity: boolean
}

/**
 * Reduce the gathered candidate set to a canonical-owner decision for an
 * ownership-proven add. Filters bare passwordless stubs, keeps only accounts
 * that actually OWN the normalized email, maps each to its canonical parent id,
 * then defers to {@link evaluateAddEmailOwnership}. Fails closed on an empty
 * email/current user or a failed directory lookup.
 */
export function planAddEmailOwnership(params: {
  email: string
  currentUserId: string
  candidates: AddEmailCandidate[]
  lookupOk: boolean
}): AddEmailOwnershipDecision {
  const normalized = normalizeEmail(params.email)
  if (!normalized) return { ok: false, reason: "unavailable" }
  if (!params.currentUserId) return { ok: false, reason: "unavailable" }
  if (!params.lookupOk) return { ok: false, reason: "unavailable" }

  const owners: CanonicalOwner[] = []
  for (const candidate of params.candidates) {
    if (!candidate.hasRealIdentity) continue // transient passwordless OTP stub — not an owner
    const owns = candidate.ownedEmails.some((e) => normalizeEmail(e) === normalized)
    if (!owns) continue
    owners.push({ canonicalUserId: candidate.userId })
  }

  return evaluateAddEmailOwnership({
    email: normalized,
    currentUserId: params.currentUserId,
    owners,
    lookupOk: true,
  })
}

/**
 * One page of a deterministic user-directory enumeration: the records on the
 * page plus the directory's reported grand total (used to detect completeness).
 */
export interface EnumeratedUserPage<TUser> {
  users: TUser[]
  total: number
}

/**
 * The result of a full enumeration: the reduced add-email candidates plus an
 * `ok` completeness flag. `ok` is TRUE only when every reported record was
 * fetched without error; a thrown page, an unexpected empty page before the
 * total is reached, or hitting `maxPages` before the total all yield `ok: false`
 * so the ownership guard fails CLOSED (reject) rather than assume no foreign
 * owner from a partial directory read.
 */
export interface EnumerationResult {
  candidates: AddEmailCandidate[]
  ok: boolean
}

/**
 * Deterministically enumerate the ENTIRE user directory through an injected
 * paginated fetch and reduce each record to an {@link AddEmailCandidate}. This
 * replaces the eventually-consistent v3 indexed search, which does NOT surface a
 * linked SOCIAL identity's `profileData.email` on this tenant — the exact gap
 * that let a foreign account's linked Gmail be added to a second account.
 *
 * Correctness over performance: it reads every page (deduped by id) until the
 * collected count reaches the directory total. It FAILS CLOSED on:
 *   • any page fetch throwing (directory error),
 *   • a page returning zero records before the total is reached (cannot make
 *     progress / inconsistent directory),
 *   • exhausting `maxPages` before the total is reached (truncation — e.g. the
 *     directory is larger than the deep-pagination cap).
 * The pure core takes the fetch as a dependency so pagination, later-page owner
 * discovery, failure and truncation are all unit-testable without Auth0.
 */
export async function enumerateOwnershipCandidates<TUser>(params: {
  fetchPage: (page: number, perPage: number) => Promise<EnumeratedUserPage<TUser>>
  perPage: number
  maxPages: number
  identify: (user: TUser) => string
  toCandidate: (user: TUser) => AddEmailCandidate
}): Promise<EnumerationResult> {
  const collected = new Map<string, AddEmailCandidate>()
  let total = Number.POSITIVE_INFINITY

  for (let page = 0; page < params.maxPages; page++) {
    let result: EnumeratedUserPage<TUser>
    try {
      result = await params.fetchPage(page, params.perPage)
    } catch {
      // A directory read failed — an incomplete set cannot prove a foreign owner
      // is absent. Fail closed.
      return { candidates: [...collected.values()], ok: false }
    }

    if (page === 0) total = result.total

    for (const user of result.users) {
      const id = params.identify(user)
      if (!id) continue
      if (!collected.has(id)) collected.set(id, params.toCandidate(user))
    }

    if (collected.size >= total) {
      return { candidates: [...collected.values()], ok: true }
    }

    // No further progress is possible but the total was not reached: the
    // directory is inconsistent or truncated. Fail closed.
    if (result.users.length === 0) {
      return { candidates: [...collected.values()], ok: false }
    }
  }

  // Exhausted the page budget before covering the whole directory (truncation).
  const complete = collected.size >= total
  return { candidates: [...collected.values()], ok: complete }
}

/**
 * Hydrate a set of enumerated user ids into full ownership candidates through an
 * injected per-user fetch, with BOUNDED CONCURRENCY. This exists because the
 * directory LIST payload (`GET /users`) omits `identities[].profileData.email` on
 * this tenant, so the list records cannot be trusted to reveal a linked SOCIAL
 * identity's email. Only a full per-user read (`GET /users/{id}`) returns the
 * identity `profileData`, so every enumerated id is re-fetched here before its
 * ownership set is built.
 *
 * FAILS CLOSED (`ok: false`) — so the ownership guard rejects rather than assume
 * no foreign owner — on:
 *   • any empty / missing user id in the input,
 *   • any per-user fetch throwing,
 *   • a hydrated record whose id does not match the requested id (mismatch).
 * `ok` is TRUE only when every id hydrated successfully. Never throws.
 */
export async function hydrateOwnershipCandidates<TUser>(params: {
  userIds: string[]
  fetchUser: (userId: string) => Promise<TUser>
  identify: (user: TUser) => string
  toCandidate: (user: TUser) => AddEmailCandidate
  concurrency: number
}): Promise<EnumerationResult> {
  const { userIds, fetchUser, identify, toCandidate, concurrency } = params

  // A missing id means the enumeration handed us an unusable record — we cannot
  // prove a foreign owner is absent from an incomplete id set. Fail closed.
  if (userIds.some((id) => !id)) return { candidates: [], ok: false }
  if (userIds.length === 0) return { candidates: [], ok: true }

  const candidates: Array<AddEmailCandidate | undefined> = new Array(userIds.length)
  let failed = false
  let cursor = 0

  const workerCount = Math.max(1, Math.min(concurrency, userIds.length))

  async function worker(): Promise<void> {
    while (!failed) {
      const index = cursor++
      if (index >= userIds.length) return
      const id = userIds[index]
      let user: TUser
      try {
        user = await fetchUser(id)
      } catch {
        failed = true
        return
      }
      // The hydrated record must be exactly the one we asked for; a mismatch
      // means we cannot trust the ownership set. Fail closed.
      if (identify(user) !== id) {
        failed = true
        return
      }
      candidates[index] = toCandidate(user)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const present = candidates.filter((c): c is AddEmailCandidate => c !== undefined)
  if (failed || present.length !== userIds.length) {
    return { candidates: present, ok: false }
  }
  return { candidates: present, ok: true }
}

/**
 * One top-level record for the transient-stub cleanup decision: its id, root
 * email, and the providers of its identities.
 */
export interface StubCandidate {
  userId: string
  rootEmail: string
  identityProviders: string[]
}

/**
 * Select the ids of TRANSIENT passwordless stubs to delete on a rejected add:
 * top-level records whose root email is the submitted address AND whose every
 * identity is passwordless (`email`/`sms`). A record holding any real identity
 * (a genuine account) is NEVER selected, so cleanup can only ever remove the
 * OTP artifact the emailed-code step minted — never a real customer's account.
 */
export function selectTransientEmailStubIds(params: {
  email: string
  candidates: StubCandidate[]
}): string[] {
  const normalized = normalizeEmail(params.email)
  if (!normalized) return []
  const out: string[] = []
  for (const candidate of params.candidates) {
    if (!candidate.userId) continue
    if (normalizeEmail(candidate.rootEmail) !== normalized) continue
    const providers = candidate.identityProviders
    const allPasswordless =
      providers.length > 0 && providers.every((p) => p === "email" || p === "sms")
    if (allPasswordless) out.push(candidate.userId)
  }
  return out
}

/**
 * A minimal, framework-free shape of an Auth0 user for identity-email extraction:
 * its root email plus each identity's own email (top-level and/or `profileData`).
 */
export interface IdentityEmailSource {
  email?: unknown
  identities?: Array<{
    email?: unknown
    profileData?: Record<string, unknown> | null
  }> | null
}

/**
 * Collect EVERY normalized email this account owns across its root email and
 * ALL of its identities — a database identity's email AND a SOCIAL identity's
 * `profileData.email` (e.g. a linked Google account), regardless of the
 * identity's `email_verified` flag.
 *
 * This is deliberately BROADER than the login/provisioning notion of a
 * "verified" email: for the canonical-ownership guard, an address that exists on
 * ANY identity of an account IS owned by that account — a linked Google identity
 * carrying `foo@gmail.com` means that account owns `foo@gmail.com`, even if the
 * social profileData omits or stringifies `email_verified`. Missing this is what
 * let a Gmail owned only via a foreign account's linked Google identity slip past
 * discovery and be linked into a second account.
 */
export function collectIdentityOwnedEmails(user: IdentityEmailSource): string[] {
  const out = new Set<string>()

  const root = normalizeEmail(user.email)
  if (root) out.add(root)

  for (const identity of user.identities ?? []) {
    const direct = normalizeEmail(identity?.email)
    if (direct) out.add(direct)
    const pd = (identity?.profileData ?? {}) as Record<string, unknown>
    const pdEmail = normalizeEmail(pd.email)
    if (pdEmail) out.add(pdEmail)
  }

  return [...out]
}

/** Neutral, customer-safe copy for a rejected add. */
export function addEmailRejectionCopy(
  reason: "different-owner" | "ambiguous" | "unavailable",
): string {
  switch (reason) {
    case "different-owner":
      return "This email is already used by another account and cannot be added here."
    case "ambiguous":
      return "This email is already used by another account and cannot be added here."
    case "unavailable":
      return "We couldn't verify that email right now. Please try again."
  }
}

/** The HTTP contract every email-linking route returns for a guard decision. */
export type AddEmailGuardResponse =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * PURE mapping from an ownership decision to the exact `{ status, error }` an
 * email-linking route returns. This is the shared contract behind the server
 * `guardAddEmailOwnership` bridge, extracted so every route's rejection copy and
 * status can be asserted without booting the Next runtime or Auth0:
 *   • allow                        → { ok: true }
 *   • different-owner / ambiguous  → 409 + neutral "already used by another
 *                                    account" copy (a foreign linked-Google
 *                                    address lands here)
 *   • unavailable (fail-closed)    → 502 + retry copy
 */
export function mapAddEmailGuardResponse(
  decision: AddEmailOwnershipDecision,
): AddEmailGuardResponse {
  if (decision.ok) return { ok: true }
  return {
    ok: false,
    status: decision.reason === "unavailable" ? 502 : 409,
    error: addEmailRejectionCopy(decision.reason),
  }
}
