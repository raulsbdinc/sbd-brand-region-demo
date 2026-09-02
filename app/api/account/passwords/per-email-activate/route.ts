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
  connectionIdForKey,
  primaryAccountEmail,
  readBindings,
} from "@/lib/credential-resolver"
import {
  appendCredentialBinding,
  buildCredentialBinding,
} from "@/lib/credential-provisioning"
import {
  planPerEmailActivation,
  type PerEmailActivationRejectReason,
} from "@/lib/per-email-activation"
import { passwordRealmExchange } from "@/lib/auth0-password-grant"
import { resolveSigninCredential } from "@/lib/credential-resolver"

export const dynamic = "force-dynamic"

/**
 * PER-EMAIL PAIR ACTIVATION (Model 3)
 * ===================================
 * POST /api/account/passwords/per-email-activate
 *
 * Turns a canonical customer that currently has ONE password credential
 * (typically a per-brand primary) PLUS an OTP-verified secondary email (an
 * `email` alias with NO password) into a TRUE per-email pair: two separate
 * database identities on the configured per-email connection, both linked to
 * the same canonical account, recorded as TWO distinct credential bindings.
 *
 * The customer proves ownership by confirming their CURRENT password for the
 * primary email A; a brand-new password is set for the secondary email B. This
 * runs entirely inside /profile — no hosted redirect, no model vocabulary.
 *
 * SECURITY CONTRACT
 * -----------------
 * The browser submits ONLY: `secondaryEmail` (which verified alias to activate),
 * `currentPassword` (proof for A), and `newPassword` (for B). The primary email,
 * the connection name/id, and every binding are resolved SERVER-SIDE from the
 * re-read primary account and SITE_BRAND. Ownership of both emails is proven
 * against the live directory. Passwords are never logged or written to metadata.
 * The op is transactional as far as Management permits: any failure rolls back
 * every identity/link/binding it created, and re-running after a partial success
 * is idempotent (it reuses already-provisioned identities rather than duplicating).
 */
export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response
  // Capture the id so nested closures keep the narrowed (ok:true) type.
  const primaryUserId = guard.user.sub

  // Same-origin protection consistent with the other account mutation routes.
  const origin = request.headers.get("origin")
  const host = request.headers.get("host")
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: "That request isn't valid." }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: "That request isn't valid." }, { status: 403 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const secondaryEmailInput =
    typeof body.secondaryEmail === "string" ? body.secondaryEmail : ""
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : ""
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""

  if (!secondaryEmailInput || !currentPassword || !newPassword) {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json(
      { error: "Use at least 8 characters for the new password." },
      { status: 400 },
    )
  }

  const perEmailConnection = connectionNameForKey("per-email")
  const perEmailConnectionId = connectionIdForKey("per-email")
  if (!perEmailConnection) {
    return NextResponse.json(
      { error: "This option isn't available right now." },
      { status: 400 },
    )
  }

  try {
    // Re-read the primary account so ownership/verification is proven live.
    const primary = await getUser(primaryUserId)
    const bindings = readBindings(primary)

    // An email has a BACKED per-email credential when it has a per-email binding
    // AND a real linked identity on the per-email connection (partial-retry reuse).
    const perEmailIdentityEmails = new Set(
      (primary.identities ?? [])
        .filter((id) => id.provider === "auth0" && id.connection === perEmailConnection)
        .map((id) => (id.profileData as { email?: string } | undefined)?.email ?? "")
        .filter(Boolean)
        .map((e) => e.toLowerCase()),
    )
    const backedPerEmailEmails = bindings
      .filter((b) => b.connectionKey === "per-email")
      .map((b) => b.email.toLowerCase())
      .filter((email) => perEmailIdentityEmails.has(email))

    // Pure planner: resolve exactly which two emails become per-email identities
    // and which (if any) already exist, from server-proven state only.
    const plan = planPerEmailActivation({
      primaryEmail: primaryAccountEmail(primary),
      secondaryEmail: secondaryEmailInput,
      verifiedEmails: collectAccountVerifiedEmails(primary),
      existingBindings: bindings,
      backedPerEmailEmails,
      configuredKeys: configuredConnectionKeySet(),
    })

    if (!plan.ok) {
      return NextResponse.json(
        { error: activationRejection(plan.reason) },
        { status: plan.reason === "not-configured" ? 400 : 400 },
      )
    }

    // A no-op idempotent completion: the pair already exists and is backed.
    if (plan.alreadyActivated) {
      return NextResponse.json({
        configured: true,
        activated: true,
        credentials: [
          { email: plan.primaryEmail, label: `Password for ${plan.primaryEmail}` },
          { email: plan.secondaryEmail, label: `Password for ${plan.secondaryEmail}` },
        ],
      })
    }

    // --- Prove ownership of primary email A via its CURRENT credential -------
    // Resolve A's current connection (per-brand for an untouched Model-4
    // account, or per-email if A was already provisioned in a prior partial
    // run). Verify the current password against THAT realm — never a guess.
    const region = regionConfig()
    if (!region) {
      return NextResponse.json({ error: "This option isn't available right now." }, { status: 400 })
    }
    const firstHop = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? ""

    const aResolution = await resolveSigninCredential(plan.primaryEmail)
    const aConnectionKey = aResolution?.connectionKey ?? null
    if (!aConnectionKey) {
      // Fail closed: we cannot prove A without a resolvable current credential.
      return NextResponse.json(
        { error: "We couldn't verify your current password. Please try again." },
        { status: 401 },
      )
    }

    const verified = await passwordRealmExchange({
      domain: region.domain,
      clientId: region.clientId,
      clientSecret: region.clientSecret,
      firstHop,
      username: plan.primaryEmail,
      password: currentPassword,
      connectionKey: aConnectionKey,
    })
    if (!verified) {
      // Generic auth failure — never reveal which factor was wrong.
      return NextResponse.json(
        { error: "That current password is incorrect." },
        { status: 401 },
      )
    }

    // --- Cross-account collision guard on the per-email connection ----------
    // If ANOTHER account already holds either email on the per-email connection,
    // linking would make sign-in unresolvable. (Same-account existing per-email
    // identities were already classified by the planner as "reuse".)
    for (const target of [plan.primaryEmail, plan.secondaryEmail]) {
      const owners = await getUsersByEmail(target)
      const foreignOwner = owners.some(
        (u) =>
          u.user_id !== primaryUserId &&
          (u.identities ?? []).some(
            (id) => id.provider === "auth0" && id.connection === perEmailConnection,
          ),
      )
      if (foreignOwner) {
        return NextResponse.json(
          { error: "That email is already set up on another account." },
          { status: 409 },
        )
      }
    }

    // --- Transactional provisioning with rollback ---------------------------
    // Track everything we create so a later failure can undo it. Identities that
    // already existed (partial-retry reuse) are NOT tracked for deletion.
    const createdUserIds: string[] = []
    const linkedIdentities: Array<{ provider: string; user_id: string }> = []

    // Look up an already-linked per-email identity's user_id for an email
    // (partial-retry reuse), so we can bind it without re-creating.
    function existingPerEmailUserId(email: string): string | null {
      const normalized = email.toLowerCase()
      const match = (primary.identities ?? []).find(
        (id) =>
          id.provider === "auth0" &&
          id.connection === perEmailConnection &&
          ((id.profileData as { email?: string } | undefined)?.email ?? "").toLowerCase() ===
            normalized,
      )
      return match?.user_id ?? null
    }

    async function provisionOne(
      email: string,
      password: string,
      create: boolean,
    ): Promise<{ auth0UserId: string }> {
      // Idempotent reuse: if this account already has a per-email identity for
      // this email (from a prior partial run), reuse it rather than duplicate.
      if (!create) {
        const reuseId = existingPerEmailUserId(email)
        if (reuseId) return { auth0UserId: reuseId }
        // Planner said no-create but no identity found → provision defensively.
      }

      let created: Auth0User
      try {
        created = await createUser({
          connection: perEmailConnection!,
          email,
          password,
          emailVerified: true, // ownership already proven (verified alias/primary)
        })
      } catch (err) {
        if (err instanceof ManagementError) {
          const msg = err.message.toLowerCase()
          if (
            msg.includes("passwordstrength") ||
            msg.includes("invalid_password") ||
            msg.includes("password is too weak")
          ) {
            throw new ActivationError(
              "That password doesn't meet the requirements. Try a stronger one.",
              400,
            )
          }
          if (err.status === 409) {
            throw new ActivationError("That email is already set up on another account.", 409)
          }
        }
        throw err
      }

      const createdId = created.user_id
      const createdIdentity = (created.identities ?? [])[0]
      if (!createdId || !createdIdentity) {
        if (createdId) await safeDelete(createdId)
        throw new ManagementError("User creation returned no identity", 502)
      }
      createdUserIds.push(createdId)

      // Link by reference to the canonical primary (never mint a token).
      try {
        await linkIdentity(primaryUserId, {
          provider: createdIdentity.provider,
          user_id: createdIdentity.user_id,
          ...(perEmailConnectionId ? { connection_id: perEmailConnectionId } : {}),
        })
      } catch (err) {
        await safeDelete(createdId)
        createdUserIds.pop()
        throw err
      }
      linkedIdentities.push({
        provider: createdIdentity.provider,
        user_id: createdIdentity.user_id,
      })

      return { auth0UserId: createdIdentity.user_id }
    }

    try {
      const aResult = await provisionOne(
        plan.primaryEmail,
        currentPassword,
        plan.createPrimary,
      )
      const bResult = await provisionOne(
        plan.secondaryEmail,
        newPassword,
        plan.createSecondary,
      )

      // Append BOTH per-email bindings, preserving all existing metadata and
      // bindings (Model-4 brand rows are kept for canonical coexistence). The
      // pure builder dedupes, so re-running is idempotent at the binding layer.
      let nextBindings = readBindings(primary)
      nextBindings = appendCredentialBinding(
        nextBindings,
        buildCredentialBinding({
          connectionKey: "per-email",
          email: plan.primaryEmail,
          useCase: "per-email-password",
          auth0UserId: aResult.auth0UserId,
        }),
      )
      nextBindings = appendCredentialBinding(
        nextBindings,
        buildCredentialBinding({
          connectionKey: "per-email",
          email: plan.secondaryEmail,
          useCase: "per-email-password",
          auth0UserId: bResult.auth0UserId,
        }),
      )

      await updateUser(primaryUserId, {
        app_metadata: {
          ...(primary.app_metadata ?? {}),
          credential_bindings: nextBindings,
        },
      })

      return NextResponse.json({
        configured: true,
        activated: true,
        credentials: [
          { email: plan.primaryEmail, label: `Password for ${plan.primaryEmail}` },
          { email: plan.secondaryEmail, label: `Password for ${plan.secondaryEmail}` },
        ],
      })
    } catch (err) {
      // Roll back everything we created in THIS run (best effort). Identities
      // reused from a prior partial run are intentionally left in place.
      for (const link of linkedIdentities) {
        await safeUnlink(primaryUserId, link.provider, link.user_id)
      }
      for (const id of createdUserIds) {
        await safeDelete(id)
      }
      if (err instanceof ActivationError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err) {
    return managementErrorResponse(err)
  }
}

/** A thrown error carrying a customer-safe message + status for clean mapping. */
class ActivationError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Neutral customer-facing copy for each planner rejection reason. */
function activationRejection(reason: PerEmailActivationRejectReason): string {
  switch (reason) {
    case "secondary-not-eligible":
      return "Add and verify that email in Email addresses first."
    case "primary-not-eligible":
      return "We couldn't set this up for your account. Please try again."
    case "same-email":
      return "Choose a different email from your primary."
    case "not-configured":
      return "This option isn't available right now."
    default:
      return "That request isn't valid."
  }
}
}

/** Region OAuth config, read from env server-side (mirrors the sign-in route). */
function regionConfig(): { domain: string; clientId: string; clientSecret: string } | null {
  const domain = process.env.AUTH0_DOMAIN
  const clientId = process.env.AUTH0_CLIENT_ID
  const clientSecret = process.env.AUTH0_CLIENT_SECRET
  if (!domain || !clientId || !clientSecret) return null
  return { domain, clientId, clientSecret }
}

async function safeDelete(userId: string): Promise<void> {
  try {
    await deleteUser(userId)
  } catch (err) {
    console.log("[v0] activation rollback: user delete failed:", (err as Error).message)
  }
}

async function safeUnlink(
  primaryId: string,
  provider: string,
  secondaryId: string,
): Promise<void> {
  try {
    await unlinkIdentity(primaryId, provider, secondaryId)
  } catch (err) {
    console.log("[v0] activation rollback: unlink failed:", (err as Error).message)
  }
}
