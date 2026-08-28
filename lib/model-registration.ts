// SERVER-ONLY MODEL 3 / MODEL 4 PROVISIONING EXECUTOR
// ===================================================
// The Auth0-side executor for the UK account models, sitting BEHIND the pure
// planners in lib/account-model.ts. Given a plan the pure module already
// approved (connection resolved server-side, market/brand/coherence enforced),
// it performs the create → link → bind sequence with best-effort rollback, and
// maps every tenant error to a neutral, customer-safe message. It NEVER accepts
// a connection name/id, user id, use case, or brand from the browser — the route
// hands it only an already-resolved plan plus the password(s).
//
// Shape mirrors app/api/account/passwords/route.ts exactly (the reviewed
// create/link/bind/rollback reference); the two share buildCredentialBinding /
// appendCredentialBinding and the same rollback discipline so a partial failure
// never leaves a dangling identity or a linked-but-unbound credential.

import "server-only"
import {
  createUser,
  deleteUser,
  getUser,
  getUsersByEmail,
  linkIdentity,
  unlinkIdentity,
  updateUser,
  ManagementError,
  type Auth0User,
} from "@/lib/auth0-management"
import {
  appendCredentialBinding,
  buildCredentialBinding,
} from "@/lib/credential-provisioning"
import { connectionIdForKey, readBindings } from "@/lib/credential-resolver"
import type { ConnectionKey, CredentialBinding, DemoUseCase } from "@/lib/credential-model"
import type { BrandId } from "@/lib/types"

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

/** Light pre-check; the connection's real policy is enforced by Auth0 on create. */
function passwordError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password.length > 128) return "That password is too long."
  return null
}

/** Map a tenant create error to a neutral customer message (never raw). */
function neutralCreateError(err: unknown): { status: number; error: string } {
  if (err instanceof ManagementError) {
    const msg = err.message.toLowerCase()
    if (
      msg.includes("passwordstrength") ||
      msg.includes("invalid_password") ||
      msg.includes("password is too weak")
    ) {
      return { status: 400, error: "That password doesn't meet the requirements. Try a stronger one." }
    }
    if (err.status === 409) {
      return { status: 409, error: "An account already uses that email here." }
    }
  }
  return { status: 502, error: "We couldn't complete that right now. Please try again." }
}

/** True when ANY existing record already holds `email` on `connectionName`. */
async function hasCollision(email: string, connectionName: string): Promise<boolean> {
  const existing = await getUsersByEmail(email)
  return existing.some((u) =>
    (u.identities ?? []).some(
      (id) => id.provider === "auth0" && id.connection === connectionName,
    ),
  )
}

async function safeDelete(userId: string): Promise<void> {
  try {
    await deleteUser(userId)
  } catch (err) {
    console.log("[v0] model-registration rollback: delete failed:", (err as Error).message)
  }
}

async function safeUnlink(primaryId: string, provider: string, secondaryId: string): Promise<void> {
  try {
    await unlinkIdentity(primaryId, provider, secondaryId)
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
export async function executePerEmailRegistration(params: {
  connectionKey: "per-email"
  connectionName: string
  identities: IdentityToCreate[]
}): Promise<ExecOutcome> {
  const { connectionKey, connectionName, identities } = params
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
      if (await hasCollision(id.email, connectionName)) {
        return { ok: false, status: 409, error: "An account already uses that email here." }
      }
    } catch {
      return { ok: false, status: 502, error: "We couldn't verify that right now. Please try again." }
    }
  }

  // --- Create primary ------------------------------------------------------
  let primary: Auth0User
  try {
    primary = await createUser({
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
    if (primaryId) await safeDelete(primaryId)
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
    for (const l of linked) await safeUnlink(primaryId, l.provider, l.userId)
    // Delete secondaries first, then the primary profile.
    for (const uid of createdUserIds.slice(1)) await safeDelete(uid)
    await safeDelete(primaryId)
  }

  // --- Create + link each secondary ---------------------------------------
  for (const id of identities.slice(1)) {
    let secondary: Auth0User
    try {
      secondary = await createUser({ connection: connectionName, email: id.email, password: id.password })
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
    const connId = connectionIdForKey(connectionKey)
    try {
      await linkIdentity(primaryId, {
        provider: secondaryIdentity.provider,
        user_id: secondaryIdentity.user_id,
        ...(connId ? { connection_id: connId } : {}),
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
    await updateUser(primaryId, {
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
async function linkCredentialToPrimary(params: {
  primaryUserId: string
  connectionKey: ConnectionKey
  connectionName: string
  email: string
  password: string
  useCase: DemoUseCase
  brand?: BrandId
  duplicateMessage: string
}): Promise<ExecOutcome> {
  const { primaryUserId, connectionKey, connectionName, email, password, useCase, brand } = params
  const pwErr = passwordError(password)
  if (pwErr) return { ok: false, status: 400, error: pwErr }

  let primary: Auth0User
  try {
    primary = await getUser(primaryUserId)
  } catch {
    return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
  }

  try {
    if (await hasCollision(email, connectionName)) {
      return { ok: false, status: 409, error: params.duplicateMessage }
    }
  } catch {
    return { ok: false, status: 502, error: "We couldn't verify that right now. Please try again." }
  }

  let created: Auth0User
  try {
    created = await createUser({ connection: connectionName, email, password })
  } catch (err) {
    return { ok: false, ...neutralCreateError(err) }
  }
  const createdId = created.user_id
  const createdIdentity = (created.identities ?? [])[0]
  if (!createdId || !createdIdentity) {
    if (createdId) await safeDelete(createdId)
    return { ok: false, status: 502, error: "We couldn't complete that right now. Please try again." }
  }

  const connId = connectionIdForKey(connectionKey)
  try {
    await linkIdentity(primaryUserId, {
      provider: createdIdentity.provider,
      user_id: createdIdentity.user_id,
      ...(connId ? { connection_id: connId } : {}),
    })
  } catch {
    await safeDelete(createdId)
    return { ok: false, status: 502, error: "We couldn't link that credential. Please try again." }
  }

  const binding = buildCredentialBinding({
    connectionKey,
    email,
    useCase,
    auth0UserId: createdIdentity.user_id,
    brand,
  })
  const nextBindings = appendCredentialBinding(readBindings(primary), binding)

  try {
    await updateUser(primaryUserId, {
      app_metadata: {
        ...(primary.app_metadata ?? {}),
        credential_bindings: nextBindings,
      },
    })
  } catch {
    await safeUnlink(primaryUserId, createdIdentity.provider, createdIdentity.user_id)
    await safeDelete(createdId)
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
export async function executeBrandLink(params: {
  primaryUserId: string
  connectionKey: "dewalt" | "stanley"
  connectionName: string
  email: string
  password: string
  brand: BrandId
}): Promise<ExecOutcome> {
  return linkCredentialToPrimary({
    ...params,
    useCase: "per-brand-password",
    duplicateMessage: "A different password is already set up for that brand.",
  })
}

/**
 * Model 3 completion: link a NOW-verified second per-email identity under an
 * existing per-email primary. Ownership of the second email is proven by the
 * calling route (one-time email code) before this runs.
 */
export async function executePerEmailLink(params: {
  primaryUserId: string
  connectionName: string
  email: string
  password: string
}): Promise<ExecOutcome> {
  return linkCredentialToPrimary({
    ...params,
    connectionKey: "per-email",
    useCase: "per-email-password",
    duplicateMessage: "That email already has its own password.",
  })
}
