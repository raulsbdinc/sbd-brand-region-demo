// MODEL 3 / MODEL 4 PROVISIONING EXECUTOR
// =======================================
// The Auth0-side executor for the UK account models, sitting BEHIND the pure
// planners in lib/account-model.ts. Given a plan the pure module already
// approved (connection name + id resolved server-side, market/brand/coherence
// enforced), it performs the create → link → bind sequence with best-effort
// rollback, and maps every tenant error to a neutral, customer-safe message. It
// NEVER accepts a connection name/id, user id, use case, or brand from the
// browser — the route hands it only an already-resolved plan plus password(s).
//
// Shape mirrors app/api/account/passwords/route.ts (the reviewed
// create/link/bind/rollback reference); the two share buildCredentialBinding /
// appendCredentialBinding and the same rollback discipline so a partial failure
// never leaves a dangling identity or a linked-but-unbound credential.
//
// IMPORT DISCIPLINE: this module takes the Management API as an INJECTED
// `ManagementDeps` and imports auth0-management / credential-resolver ONLY as
// TYPES. That keeps it free of any top-level `server-only` import so its
// create/link/bind/ROLLBACK sequencing is unit-testable with a fake tenant
// (node:test cannot mock ESM imports). The real, server-only deps live in
// lib/model-registration-deps.ts; routes pass them in.

import {
  appendCredentialBinding,
  buildCredentialBinding,
} from "./credential-provisioning.ts"
import { validateRegistrationPassword } from "./password-policy.ts"
import type { Auth0User } from "./auth0-management.ts"
import type { ConnectionKey, CredentialBinding, DemoUseCase } from "./credential-model.ts"
import type { BrandId } from "./types"

/**
 * The exact slice of the Management API this executor touches, injected so the
 * rollback sequencing can be exercised against a fake tenant. Production wiring
 * is lib/model-registration-deps.ts (server-only); tests pass a fake.
 */
export interface ManagementDeps {
  createUser(body: {
    connection: string
    email: string
    password: string
    /** True ONLY when the caller has proven ownership of `email`. */
    emailVerified: boolean
  }): Promise<Auth0User>
  deleteUser(userId: string): Promise<unknown>
  getUser(userId: string): Promise<Auth0User>
  getUsersByEmail(email: string): Promise<Auth0User[]>
  linkIdentity(
    primaryUserId: string,
    body: { provider: string; user_id: string; connection_id?: string },
  ): Promise<unknown>
  unlinkIdentity(primaryUserId: string, provider: string, secondaryUserId: string): Promise<unknown>
  updateUser(userId: string, body: { app_metadata?: Record<string, unknown> }): Promise<Auth0User>
}

const MIN_PASSWORD_LENGTH = 8

export interface CreatedCredential {
  bindingId: string
  connectionKey: ConnectionKey
  email: string
  brand?: BrandId
}

export type ExecOutcome =
  | { ok: true; primaryUserId: string; credentials: CreatedCredential[] }
  | { ok: false; status: number; error: string }

/** Read the persisted bindings off a user record (pure; no server import). */
function readBindingsFrom(user: Auth0User): CredentialBinding[] {
  const raw = (user.app_metadata as { credential_bindings?: unknown } | undefined)
    ?.credential_bindings
  return Array.isArray(raw) ? (raw as CredentialBinding[]) : []
}

/** Light pre-check; the connection's real policy is enforced by Auth0 on create. */
function passwordError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password.length > 128) return "That password is too long."
  return null
}

/**
 * Map a tenant create error to a neutral customer message (never raw). Uses
 * duck typing (a `status` number + message text) instead of `instanceof
 * ManagementError`, so this module needs no runtime import of the server-only
 * management client.
 */
function neutralCreateError(err: unknown): { status: number; error: string } {
  const status = typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status
    : undefined
  const msg = (err instanceof Error ? err.message : "").toLowerCase()
  if (
    msg.includes("passwordstrength") ||
    msg.includes("invalid_password") ||
    msg.includes("password is too weak")
  ) {
    return { status: 400, error: "That password doesn't meet the requirements. Try a stronger one." }
  }
  if (status === 409) {
    return { status: 409, error: "An account already uses that email here." }
  }
  return { status: 502, error: "We couldn't complete that right now. Please try again." }
}

/** True when ANY existing record already holds `email` on `connectionName`. */
async function hasCollision(
  deps: ManagementDeps,
  email: string,
  connectionName: string,
): Promise<boolean> {
  const existing = await deps.getUsersByEmail(email)
  return existing.some((u) =>
    (u.identities ?? []).some(
      (id) => id.provider === "auth0" && id.connection === connectionName,
    ),
  )
}

async function safeDelete(deps: ManagementDeps, userId: string): Promise<void> {
  try {
    await deps.deleteUser(userId)
  } catch (err) {
    console.log("[v0] model-registration rollback: delete failed:", (err as Error).message)
  }
}

async function safeUnlink(
  deps: ManagementDeps,
  primaryId: string,
  provider: string,
  secondaryId: string,
): Promise<void> {
  try {
    await deps.unlinkIdentity(primaryId, provider, secondaryId)
  } catch (err) {
    console.log("[v0] model-registration rollback: unlink failed:", (err as Error).message)
  }
}

/**
 * Best-effort delete of the transient passwordless proof stubs (e.g.
 * "email|…") that consuming a one-time code mints at the IdP. In the Model 3
 * flow the code is proof ONLY — the real account is a fresh DB identity — so
 * the stub must never linger, whether the registration then succeeds or fails.
 * Never throws: an undeleted stub is untidy, not user-facing, and must not turn
 * a successful registration into a failure.
 */
async function deleteStubs(deps: ManagementDeps, stubUserIds: string[]): Promise<void> {
  for (const uid of stubUserIds) {
    if (uid) await safeDelete(deps, uid)
  }
}

export interface IdentityToCreate {
  email: string
  password: string
  role: "primary" | "secondary"
  /**
   * True ONLY when the calling route has PROVEN the person owns this mailbox
   * (a completed one-time-code challenge). The executor refuses to run unless
   * every identity is proven, and stamps `email_verified` from this flag — it
   * never infers verification from the mere presence of a password.
   */
  emailVerified: boolean
}

/**
 * Model 3 (per-email): create the primary per-email identity, then optionally a
 * linked secondary, persisting one coherent binding per identity on the primary.
 * The first identity becomes the primary Auth0 profile; every later identity is
 * linked under it. Fails closed with rollback on any collision or partial error.
 */
export async function executePerEmailRegistration(
  params: {
    connectionKey: "per-email"
    connectionName: string
    /** Connection id resolved server-side; baked into each link. */
    connectionId?: string
    identities: IdentityToCreate[]
  },
  deps: ManagementDeps,
): Promise<ExecOutcome> {
  const { connectionKey, connectionName, connectionId, identities } = params
  if (identities.length === 0 || identities[0].role !== "primary") {
    return { ok: false, status: 400, error: "That request isn't valid." }
  }
  // Defence-in-depth: this executor NEVER mints a Model-3 identity that hasn't
  // completed real ownership proof. The route already gates on the signed
  // verification handoff before calling us; this second, independent check
  // means a future caller can't accidentally create an unverified identity even
  // if the route guard regressed. Fails closed without touching the tenant.
  if (!identities.every((id) => id.emailVerified === true)) {
    return { ok: false, status: 403, error: "Please verify your email address first." }
  }
  for (const id of identities) {
    const pwErr = passwordError(id.password)
    if (pwErr) return { ok: false, status: 400, error: pwErr }
  }

  // Collision guard for every email BEFORE creating anything.
  for (const id of identities) {
    try {
      if (await hasCollision(deps, id.email, connectionName)) {
        return { ok: false, status: 409, error: "An account already uses that email here." }
      }
    } catch {
      return { ok: false, status: 502, error: "We couldn't verify that right now. Please try again." }
    }
  }

  // --- Create primary ------------------------------------------------------
  let primary: Auth0User
  try {
    primary = await deps.createUser({
      connection: connectionName,
      email: identities[0].email,
      password: identities[0].password,
      emailVerified: identities[0].emailVerified,
    })
  } catch (err) {
    return { ok: false, ...neutralCreateError(err) }
  }
  const primaryId = primary.user_id
  const primaryIdentity = (primary.identities ?? [])[0]
  if (!primaryId || !primaryIdentity) {
    if (primaryId) await safeDelete(deps, primaryId)
    return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
  }

  const credentials: CreatedCredential[] = []
  const bindings: CredentialBinding[] = []
  const linked: Array<{ provider: string; userId: string }> = []
  const createdUserIds: string[] = [primaryId]

  const primaryBinding = buildCredentialBinding({
    connectionKey,
    email: identities[0].email,
    useCase: "per-email-password" as DemoUseCase,
    auth0UserId: primaryIdentity.user_id,
  })
  bindings.push(primaryBinding)
  credentials.push({ bindingId: primaryBinding.id, connectionKey, email: identities[0].email })

  const rollbackAll = async () => {
    for (const l of linked) await safeUnlink(deps, primaryId, l.provider, l.userId)
    // Delete secondaries first, then the primary profile.
    for (const uid of createdUserIds.slice(1)) await safeDelete(deps, uid)
    await safeDelete(deps, primaryId)
  }

  // --- Create + link each secondary ---------------------------------------
  for (const id of identities.slice(1)) {
    let secondary: Auth0User
    try {
      secondary = await deps.createUser({
        connection: connectionName,
        email: id.email,
        password: id.password,
        emailVerified: id.emailVerified,
      })
    } catch (err) {
      await rollbackAll()
      return { ok: false, ...neutralCreateError(err) }
    }
    const secondaryIdentity = (secondary.identities ?? [])[0]
    if (secondary.user_id) createdUserIds.push(secondary.user_id)
    if (!secondaryIdentity) {
      await rollbackAll()
      return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
    }
    try {
      await deps.linkIdentity(primaryId, {
        provider: secondaryIdentity.provider,
        user_id: secondaryIdentity.user_id,
        ...(connectionId ? { connection_id: connectionId } : {}),
      })
      linked.push({ provider: secondaryIdentity.provider, userId: secondaryIdentity.user_id })
    } catch {
      await rollbackAll()
      return { ok: false, status: 502, error: "We couldn't link that email. Please try again." }
    }
    const b = buildCredentialBinding({
      connectionKey,
      email: id.email,
      useCase: "per-email-password" as DemoUseCase,
      auth0UserId: secondaryIdentity.user_id,
    })
    bindings.push(b)
    credentials.push({ bindingId: b.id, connectionKey, email: id.email })
  }

  // --- Persist all bindings on the primary --------------------------------
  try {
    await deps.updateUser(primaryId, {
      app_metadata: {
        ...(primary.app_metadata ?? {}),
        credential_bindings: bindings,
      },
    })
  } catch {
    await rollbackAll()
    return { ok: false, status: 502, error: "We couldn't finish setting up your account. Please try again." }
  }

  return { ok: true, primaryUserId: primaryId, credentials }
}

/**
 * The IdP side of one-time-code CONSUMPTION, injected so the orchestrator below
 * is unit-testable. `verifyPasscode` must resolve ONLY when the code is valid
 * for that exact email and reject (throw) on a wrong / expired / ALREADY-USED
 * code. In production this is Auth0's passwordless OTP grant, which single-uses
 * the code at the tenant — that server-side consumption, not any cookie state,
 * is what makes replay impossible.
 */
export interface ProofDeps {
  /**
   * Consume the one-time code at the IdP. Resolves ONLY when the code is valid
   * for that exact email, and rejects (throws) on a wrong / expired /
   * already-used code. It may return the transient passwordless stub identity
   * the consumption minted (e.g. `{ sub: "email|…" }`) so the orchestrator can
   * delete that proof artifact afterwards; returning nothing is also allowed.
   */
  verifyPasscode(email: string, otp: string): Promise<{ sub?: string } | void>
}

export type Model3RegisterOutcome =
  | { ok: true; primaryUserId: string; credentials: CreatedCredential[] }
  | { ok: false; status: number; error: string; failedEmails?: string[]; needResend?: boolean }

function sameEmailSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bs = new Set(b)
  return a.every((e) => bs.has(e))
}

/**
 * Model 3 (per-email) CREATE, proof-gated by live one-time-code consumption.
 *
 * This is the single code path the create route runs, and it NEVER creates,
 * links, or binds anything until every email being registered has had its
 * one-time code CONSUMED at the IdP in this very request. Ordering matters and
 * every early exit happens before any tenant mutation:
 *
 *   1. `boundEmails` is the email set carried in the SIGNED, purpose-bound
 *      handoff. A missing / expired / tampered handoff arrives here as `null`
 *      (the codec already rejected it) → fail closed, nothing touched.
 *   2. Binding check — the emails we're about to provision must be EXACTLY the
 *      bound set, so a body can't swap in a different address than the one a
 *      code was mailed to.
 *   3. Presence check — every required email must carry a code. Checked for ALL
 *      emails BEFORE consuming any, so an incomplete request wastes no code.
 *   4. Consume each code via `verifyPasscode` (Auth0 single-uses it). A
 *      replayed / already-consumed / wrong / expired code throws → we stop with
 *      ZERO create/link/bind and report which emails need a fresh code.
 *   5. Only when ALL codes are consumed do we stamp `email_verified: true` and
 *      hand off to the provisioning executor.
 *
 * Passwords are never treated as proof; `email_verified` is set here strictly
 * from a successful consumption, so callers cannot pass a pre-verified flag.
 */
export async function registerModel3WithProof(
  params: {
    connectionKey: "per-email"
    connectionName: string
    connectionId?: string
    /** Email set from the signed handoff; null when missing/expired/tampered. */
    boundEmails: { primaryEmail: string; secondaryEmail?: string } | null
    /** Emails + passwords + roles. `email_verified` is decided here, not passed. */
    identities: Array<Omit<IdentityToCreate, "emailVerified">>
    /** Normalized-email → the one-time code submitted for it at final create. */
    codes: Record<string, string | undefined>
  },
  deps: ManagementDeps & ProofDeps,
): Promise<Model3RegisterOutcome> {
  const { boundEmails, identities, codes } = params
  const startAgain = "Please start again and confirm your email address."

  // 1) Must have a signed binding.
  if (!boundEmails) return { ok: false, status: 403, error: startAgain }
  if (identities.length === 0 || identities[0].role !== "primary") {
    return { ok: false, status: 400, error: "That request isn't valid." }
  }

  // 2) The provisioned set must be EXACTLY the bound set.
  const submitted = identities.map((i) => i.email.trim().toLowerCase())
  const bound = [boundEmails.primaryEmail, boundEmails.secondaryEmail]
    .filter((e): e is string => typeof e === "string" && e.trim() !== "")
    .map((e) => e.trim().toLowerCase())
  if (!sameEmailSet(submitted, bound)) return { ok: false, status: 403, error: startAgain }

  // 3) Every required email needs a code — verify presence for ALL first so a
  //    missing second code never causes us to consume the first.
  const missing = submitted.filter((e) => !((codes[e] ?? "").trim()))
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "Enter the code we emailed for each address.",
      failedEmails: missing,
    }
  }

  // 3.5) Validate every password against the connection policy BEFORE consuming
  //      any code. A policy rejection must NEVER cost the customer their
  //      one-time code: consuming first and only then failing the create is
  //      exactly what left an orphan passwordless stub with no real account
  //      behind it (e.g. "Ciam!2026UK1A" for sbdciam-uk1-… — rejected by
  //      Auth0's user-info rule because the email contains "uk1", which a
  //      length check never predicts). We mirror the connection policy in
  //      lib/password-policy so the browser and this gate agree exactly, and
  //      check each password against its OWN email's user-info tokens.
  for (const id of identities) {
    const check = validateRegistrationPassword(id.password, [id.email])
    if (!check.ok) {
      return {
        ok: false,
        status: 400,
        error: `That password doesn't meet the requirements: ${check.failures.join("; ")}.`,
        failedEmails: [id.email.trim().toLowerCase()],
      }
    }
  }

  // 4) Consume each code at the IdP immediately before any mutation. A replayed
  //    or otherwise bad code throws → we mutate nothing and ask for fresh codes.
  //    Capture each transient passwordless stub the consumption mints so we can
  //    delete it afterwards — in this flow the code is proof only.
  const failed: string[] = []
  const stubUserIds: string[] = []
  for (const email of submitted) {
    try {
      const consumed = await deps.verifyPasscode(email, (codes[email] as string).trim())
      const sub = consumed && typeof consumed.sub === "string" ? consumed.sub : ""
      if (sub) stubUserIds.push(sub)
    } catch {
      failed.push(email)
    }
  }
  if (failed.length > 0) {
    // One or more earlier codes may have been consumed before another failed —
    // clean up their stubs too so a failed attempt leaves nothing behind.
    await deleteStubs(deps, stubUserIds)
    return {
      ok: false,
      status: 401,
      error: "That code isn't right or has already been used. We'll email fresh codes.",
      failedEmails: failed,
      needResend: true,
    }
  }

  // 5) Ownership proven for EVERY email this request. Stamp verified + provision.
  const verified: IdentityToCreate[] = identities.map((i) => ({ ...i, emailVerified: true }))
  const outcome = await executePerEmailRegistration(
    {
      connectionKey: params.connectionKey,
      connectionName: params.connectionName,
      connectionId: params.connectionId,
      identities: verified,
    },
    deps,
  )
  // The consumed codes were proof only; the real accounts are the DB identities
  // created above. Delete the transient email|… stubs regardless of outcome so
  // a registration never leaves an orphan proof user behind (the exact residue
  // observed when a post-proof create was rejected).
  await deleteStubs(deps, stubUserIds)
  return outcome
}

/**
 * Model 4 (per-brand), FIRST brand: create a brand-new primary account whose
 * sole identity lives on this brand's connection, with one coherent per-brand
 * binding. Used when no existing account holds the email yet — the cross-brand
 * LINK path (executeBrandLink) handles the second brand. Collision-guarded with
 * rollback on a partial failure.
 */
export async function executeBrandRegistration(
  params: {
    connectionKey: "dewalt" | "stanley"
    connectionName: string
    connectionId?: string
    email: string
    password: string
    brand: BrandId
  },
  deps: ManagementDeps,
): Promise<ExecOutcome> {
  const { connectionKey, connectionName, email, password, brand } = params
  const pwErr = passwordError(password)
  if (pwErr) return { ok: false, status: 400, error: pwErr }

  try {
    if (await hasCollision(deps, email, connectionName)) {
      return { ok: false, status: 409, error: "A different password is already set up for that brand." }
    }
  } catch {
    return { ok: false, status: 502, error: "We couldn't verify that right now. Please try again." }
  }

  let primary: Auth0User
  try {
    // First brand has not proved the mailbox yet. Leave email_verified false so
    // the account stays pending until the verification message is used. The
    // route sends that message; a later proof-gated brand link still mints verified.
    primary = await deps.createUser({ connection: connectionName, email, password, emailVerified: false })
  } catch (err) {
    return { ok: false, ...neutralCreateError(err) }
  }
  const primaryId = primary.user_id
  const primaryIdentity = (primary.identities ?? [])[0]
  if (!primaryId || !primaryIdentity) {
    if (primaryId) await safeDelete(deps, primaryId)
    return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
  }

  const binding = buildCredentialBinding({
    connectionKey,
    email,
    useCase: "per-brand-password" as DemoUseCase,
    auth0UserId: primaryIdentity.user_id,
    brand,
  })

  try {
    await deps.updateUser(primaryId, {
      app_metadata: {
        ...(primary.app_metadata ?? {}),
        credential_bindings: [binding],
      },
    })
  } catch {
    await safeDelete(deps, primaryId)
    return { ok: false, status: 502, error: "We couldn't finish setting up your account. Please try again." }
  }

  return {
    ok: true,
    primaryUserId: primaryId,
    credentials: [{ bindingId: binding.id, connectionKey, email, brand }],
  }
}

/**
 * Create ONE new database identity for `email` on the resolved connection and
 * link it under an existing, already-owned primary account, appending one
 * coherent binding. Shared by the Model-4 cross-brand link and the Model-3
 * completion journey — the caller has already proven ownership of the primary
 * AND confirmed (via the pure planner) that this neither mixes models nor
 * duplicates the target. Collision-guarded, with best-effort rollback.
 */
async function linkCredentialToPrimary(
  params: {
    primaryUserId: string
    connectionKey: ConnectionKey
    connectionName: string
    connectionId?: string
    email: string
    password: string
    useCase: DemoUseCase
    brand?: BrandId
    duplicateMessage: string
  },
  deps: ManagementDeps,
): Promise<ExecOutcome> {
  const { primaryUserId, connectionKey, connectionName, connectionId, email, password, useCase, brand } =
    params
  const pwErr = passwordError(password)
  if (pwErr) return { ok: false, status: 400, error: pwErr }

  let primary: Auth0User
  try {
    primary = await deps.getUser(primaryUserId)
  } catch {
    return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
  }

  try {
    if (await hasCollision(deps, email, connectionName)) {
      return { ok: false, status: 409, error: params.duplicateMessage }
    }
  } catch {
    return { ok: false, status: 502, error: "We couldn't verify that right now. Please try again." }
  }

  let created: Auth0User
  try {
    // Ownership of `email` is proven by the caller before we get here (the
    // Model-3 completion one-time code, or the Model-4 cross-brand proof step).
    created = await deps.createUser({ connection: connectionName, email, password, emailVerified: true })
  } catch (err) {
    return { ok: false, ...neutralCreateError(err) }
  }
  const createdId = created.user_id
  const createdIdentity = (created.identities ?? [])[0]
  if (!createdId || !createdIdentity) {
    if (createdId) await safeDelete(deps, createdId)
    return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
  }

  try {
    await deps.linkIdentity(primaryUserId, {
      provider: createdIdentity.provider,
      user_id: createdIdentity.user_id,
      ...(connectionId ? { connection_id: connectionId } : {}),
    })
  } catch {
    await safeDelete(deps, createdId)
    return { ok: false, status: 502, error: "We couldn't link that credential. Please try again." }
  }

  const binding = buildCredentialBinding({
    connectionKey,
    email,
    useCase,
    auth0UserId: createdIdentity.user_id,
    brand,
  })
  const nextBindings = appendCredentialBinding(readBindingsFrom(primary), binding)

  try {
    await deps.updateUser(primaryUserId, {
      app_metadata: {
        ...(primary.app_metadata ?? {}),
        credential_bindings: nextBindings,
      },
    })
  } catch {
    await safeUnlink(deps, primaryUserId, createdIdentity.provider, createdIdentity.user_id)
    await safeDelete(deps, createdId)
    return { ok: false, status: 502, error: "We couldn't finish setting up that credential. Please try again." }
  }

  return {
    ok: true,
    primaryUserId,
    credentials: [{ bindingId: binding.id, connectionKey, email, brand }],
  }
}

/**
 * Model 4 (per-brand): create THIS brand's identity for `email` and link it
 * under an existing primary account. Ownership of the primary is already proven.
 */
export async function executeBrandLink(
  params: {
    primaryUserId: string
    connectionKey: "dewalt" | "stanley"
    connectionName: string
    connectionId?: string
    email: string
    password: string
    brand: BrandId
  },
  deps: ManagementDeps,
): Promise<ExecOutcome> {
  return linkCredentialToPrimary(
    {
      ...params,
      useCase: "per-brand-password",
      duplicateMessage: "A different password is already set up for that brand.",
    },
    deps,
  )
}

/**
 * Model 3 completion: link a NOW-verified second per-email identity under an
 * existing per-email primary. Ownership of the second email is proven by the
 * calling route (one-time email code) before this runs.
 */
export async function executePerEmailLink(
  params: {
    primaryUserId: string
    connectionName: string
    connectionId?: string
    email: string
    password: string
  },
  deps: ManagementDeps,
): Promise<ExecOutcome> {
  return linkCredentialToPrimary(
    {
      ...params,
      connectionKey: "per-email",
      useCase: "per-email-password",
      duplicateMessage: "That email already has its own password.",
    },
    deps,
  )
}
