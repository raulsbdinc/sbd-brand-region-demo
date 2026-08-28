import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import {
  getUser,
  getUsersByEmail,
  createUser,
  deleteUser,
  linkIdentity,
  unlinkIdentity,
  updateUser,
  ManagementError,
  type Auth0User,
} from "@/lib/auth0-management"
import {
  collectAccountVerifiedEmails,
  configuredConnectionKeySet,
  connectionNameForKey,
  primaryAccountEmail,
  readBindings,
} from "@/lib/credential-resolver"
import {
  appendCredentialBinding,
  buildCredentialBinding,
  computeAddPasswordAvailability,
  isProvisionIntent,
  resolveProvisioning,
  type ProvisioningContext,
  type ProvisionRejectReason,
} from "@/lib/credential-provisioning"
import { SITE_BRAND } from "@/lib/site"
import { BRANDS } from "@/lib/brands"
import type { BrandId } from "@/lib/types"

/** Minimum length we enforce before calling Auth0 (Auth0's policy is the real gate). */
const MIN_PASSWORD_LENGTH = 8

/** A light pre-check; the connection's own policy is enforced by Auth0 on create. */
function localPasswordError(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password.length > 128) return "That password is too long."
  return null
}

/** Customer-facing brand name (e.g. "DeWalt"), never an internal key. */
function brandName(brand: BrandId): string {
  return BRANDS[brand]?.name ?? "this brand"
}

// /api/account/passwords
//   GET  → what the "Add password" flow may offer this account (customer-safe).
//   POST → create ONE additional password credential for an allow-listed intent.
//
// SECURITY CONTRACT
// -----------------
// The browser may submit ONLY: an allow-listed `intent` ("another-email" |
// "this-brand"), the selected `email` (for another-email), and the `password`.
// It NEVER submits a connection name/id, user id, use case, or brand — those are
// resolved SERVER-SIDE from SITE_BRAND and the re-read primary account. Every
// rejection is a neutral, customer-safe message; raw Auth0 errors are never
// surfaced. Passwords are never logged or written to metadata.
export const dynamic = "force-dynamic"

/** Neutral customer-facing copy for each pure rejection reason. */
function rejectionMessage(reason: ProvisionRejectReason): string {
  switch (reason) {
    case "email-not-eligible":
      return "That email isn't available for a new password. Add and verify it in Email addresses first."
    case "duplicate-credential":
      return "That password already exists for this option."
    case "conflicting-credential":
      return "A different password is already set up for that email, so this option isn't available."
    case "unsupported-brand":
      return "A brand password isn't available on this site."
    case "not-configured":
      return "This option isn't available right now."
    case "invalid-intent":
    default:
      return "That request isn't valid."
  }
}

/** Build the server-proven provisioning context from a re-read primary user. */
function buildContext(primary: Auth0User): ProvisioningContext {
  return {
    siteBrand: SITE_BRAND,
    verifiedEmails: collectAccountVerifiedEmails(primary),
    primaryEmail: primaryAccountEmail(primary),
    existingBindings: readBindings(primary),
    configuredKeys: configuredConnectionKeySet(),
  }
}

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const primary = await getUser(guard.user.sub)
    const availability = computeAddPasswordAvailability(buildContext(primary))
    return NextResponse.json({ configured: true, availability })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const intent = body.intent
  const password = typeof body.password === "string" ? body.password : ""
  const selectedEmail = body.email // only meaningful for "another-email"

  if (!isProvisionIntent(intent)) {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }

  // Light server-side pre-check; the connection's real policy is enforced by
  // Auth0 on create (a policy failure is mapped to a neutral message below).
  const pwError = localPasswordError(password)
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 })
  }

  try {
    // Re-read the primary account so ownership/verification is proven from the
    // live directory, never from the request.
    const primary = await getUser(guard.user.sub)
    const context = buildContext(primary)

    // Resolve the concrete target purely from intent + server-proven state.
    const resolution = resolveProvisioning(intent, selectedEmail, context)
    if (!resolution.ok) {
      return NextResponse.json(
        { error: rejectionMessage(resolution.reason) },
        { status: 400 },
      )
    }

    const { connectionKey, email, useCase, brand } = resolution
    const connectionName = connectionNameForKey(connectionKey)
    if (!connectionName) {
      return NextResponse.json(
        { error: rejectionMessage("not-configured") },
        { status: 400 },
      )
    }

    // Cross-account / target-connection collision guard: if ANOTHER account (or
    // even a stray record) already holds this email on the TARGET connection, we
    // must not create a second one — sign-in would become unresolvable. Fail
    // closed with a neutral message. (Same-account duplicates were already
    // rejected by resolveProvisioning against the primary's own bindings.)
    const existingOnEmail = await getUsersByEmail(email)
    const collision = existingOnEmail.some((u) =>
      (u.identities ?? []).some(
        (id) => id.provider === "auth0" && id.connection === connectionName,
      ),
    )
    if (collision) {
      return NextResponse.json(
        { error: rejectionMessage("conflicting-credential") },
        { status: 409 },
      )
    }

    // --- Provision with best-effort rollback -------------------------------
    // Step 1: create the isolated database identity on the resolved connection.
    // email_verified is set true inside createUser ONLY because ownership was
    // already proven above.
    let created: Auth0User
    try {
      created = await createUser({ connection: connectionName, email, password })
    } catch (err) {
      // Nothing to roll back yet. Map a policy rejection to a neutral message;
      // a same-email-on-this-connection race surfaces as a conflict.
      if (err instanceof ManagementError) {
        const msg = err.message.toLowerCase()
        if (msg.includes("passwordstrength") || msg.includes("invalid_password") || msg.includes("password is too weak")) {
          return NextResponse.json(
            { error: "That password doesn't meet the requirements. Try a stronger one." },
            { status: 400 },
          )
        }
        if (err.status === 409) {
          return NextResponse.json(
            { error: rejectionMessage("conflicting-credential") },
            { status: 409 },
          )
        }
      }
      throw err
    }

    const createdId = created.user_id
    const createdIdentity = (created.identities ?? [])[0]
    if (!createdId || !createdIdentity) {
      // Defensive: if Auth0 didn't return a usable identity, clean up.
      if (createdId) await safeDelete(createdId)
      throw new ManagementError("User creation returned no identity", 502)
    }

    // Step 2: link the NEW identity to the signed-in primary. We link the exact
    // just-created identity (provider + user_id + connection_id-less link_with),
    // never an existing identity by email.
    try {
      await linkIdentity(guard.user.sub, { link_with: createdId })
    } catch (err) {
      // Roll back the orphan user so we never leave a danging identity.
      await safeDelete(createdId)
      throw err
    }

    // Step 3: append ONE coherent binding, preserving all existing metadata and
    // bindings. The linked secondary's user_id is the binding's auth0UserId.
    const binding = buildCredentialBinding({
      connectionKey,
      email,
      useCase,
      auth0UserId: createdIdentity.user_id,
      brand,
    })
    const nextBindings = appendCredentialBinding(readBindings(primary), binding)

    try {
      await updateUser(guard.user.sub, {
        app_metadata: {
          ...(primary.app_metadata ?? {}),
          credential_bindings: nextBindings,
        },
      })
    } catch (err) {
      // Roll back both the link and the orphan user: a linked-but-unbound
      // identity would be invisible to the resolver and un-resettable.
      await safeUnlink(guard.user.sub, createdIdentity.provider, createdIdentity.user_id)
      await safeDelete(createdId)
      throw err
    }

    // Return ONLY the safe created-credential view the UI needs.
    const label = credentialLabel(connectionKey, email, brand)
    return NextResponse.json({
      configured: true,
      credential: {
        bindingId: binding.id,
        connectionKey,
        email,
        brand,
        label,
        works: worksCopy(connectionKey, brand),
      },
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

/** Delete an orphan user, swallowing errors (best-effort cleanup). */
async function safeDelete(userId: string): Promise<void> {
  try {
    await deleteUser(userId)
  } catch (err) {
    console.log("[v0] passwords rollback: user delete failed:", (err as Error).message)
  }
}

/** Unlink a just-linked identity, swallowing errors (best-effort cleanup). */
async function safeUnlink(
  primaryId: string,
  provider: string,
  secondaryId: string,
): Promise<void> {
  try {
    await unlinkIdentity(primaryId, provider, secondaryId)
  } catch (err) {
    console.log("[v0] passwords rollback: unlink failed:", (err as Error).message)
  }
}

/** Customer-facing label for a created credential (no internal vocabulary). */
function credentialLabel(
  connectionKey: string,
  email: string,
  brand?: BrandId,
): string {
  if (connectionKey === "per-email") return `Password for ${email}`
  if (brand) return `${brandName(brand)} password`
  return "Account password"
}

/** Where this new password works, in plain customer language. */
function worksCopy(connectionKey: string, brand?: BrandId): string {
  if (connectionKey === "per-email") {
    return "This email now signs in with its own password. Your other verified emails keep using your account password."
  }
  const name = brand ? brandName(brand) : "this brand"
  return `You'll use this password on ${name} sites. Your account password still works on other SBD brands.`
}
