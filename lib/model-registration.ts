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
import type { Auth0User } from "./auth0-management.ts"
import type { ConnectionKey, CredentialBinding, DemoUseCase } from "./credential-model.ts"
import type { BrandId } from "./types"

/**
 * The exact slice of the Management API this executor touches, injected so the
 * rollback sequencing can be exercised against a fake tenant. Production wiring
 * is lib/model-registration-deps.ts (server-only); tests pass a fake.
 */
export interface ManagementDeps {
  createUser(body: { connection: string; email: string; password: string }): Promise<Auth0User>
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

export interface IdentityToCreate {
  email: string
  password: string
  role: "primary" | "secondary"
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
      secondary = await deps.createUser({ connection: connectionName, email: id.email, password: id.password })
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
    created = await deps.createUser({ connection: connectionName, email, password })
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
