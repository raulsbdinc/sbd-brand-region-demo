import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
  ensureNotLastLoginMethod,
} from "@/lib/account-guard"
import {
  getUser,
  unlinkIdentity,
  deleteUser,
  updateUser,
} from "@/lib/auth0-management"

// /api/account/identities
//   GET    → the connected accounts (identities) linked to the signed-in user.
//   DELETE → unlink a secondary identity (?provider=...&user_id=...).
//
// NOTE: LINKING a new account requires the user to authenticate with the second
// provider first (to mint a second token), then link by token. That ceremony is
// redirect-based; the Management link-by-token call is documented in
// FEATURE_BACKLOG.md Part 3. We expose unlink here because it's a pure server call.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    return NextResponse.json({
      configured: true,
      identities: user.identities ?? [],
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const provider = url.searchParams.get("provider")
  const secondaryId = url.searchParams.get("user_id")
  if (!provider || !secondaryId) {
    return NextResponse.json(
      { error: "Missing provider or user_id." },
      { status: 400 },
    )
  }

  // Guard against unlinking the PRIMARY identity (the one that equals the sub).
  if (`${provider}|${secondaryId}` === guard.user.sub) {
    return NextResponse.json(
      { error: "Cannot unlink the primary identity." },
      { status: 400 },
    )
  }

  try {
    // Never let a user remove their last way to sign in.
    const lockout = await ensureNotLastLoginMethod(guard.user.sub)
    if (lockout) return lockout

    // Capture the address of the identity being disconnected BEFORE the unlink
    // removes it from the primary's identity list, so we can drop it from the
    // password alias list afterward. Applies to both "email" and
    // "google-oauth2" identities. Best-effort read — a miss just skips cleanup.
    let disconnectedEmail: string | null = null
    try {
      const before = await getUser(guard.user.sub)
      const match = (before.identities ?? []).find(
        (id) => id.provider === provider && id.user_id === secondaryId,
      )
      disconnectedEmail =
        (match?.profileData?.email as string | undefined)?.toLowerCase() ?? null
    } catch {
      disconnectedEmail = null
    }

    const identities = await unlinkIdentity(
      guard.user.sub,
      provider,
      secondaryId,
    )

    // ORPHAN CLEANUP. Auth0's unlink turns the removed identity back into its
    // OWN standalone user record — the same duplicate/double-billing problem
    // from the other direction. Delete that orphan so a disconnect genuinely
    // removes the account. Guarded tightly: only delete a record that (a) is
    // NOT the signed-in user, and (b) has a single identity (so we can never
    // delete a real, still-linked account). If anything here fails, the unlink
    // itself already succeeded, so we still report the disconnect as done.
    const orphanId = `${provider}|${secondaryId}`
    if (orphanId !== guard.user.sub) {
      try {
        const orphan = await getUser(orphanId)
        if ((orphan.identities?.length ?? 0) === 1) {
          await deleteUser(orphanId)
        }
      } catch (cleanupErr) {
        console.log(
          "[v0] identity unlink orphan cleanup skipped:",
          (cleanupErr as Error).message,
        )
      }
    }

    // ALIAS CLEANUP. A disconnected account email must stop working as a
    // password alias. Drop it from app_metadata.login_alias_emails. Best-effort
    // and after the successful unlink — the disconnect already succeeded, so a
    // failure here still reports the disconnect as done. Only app_metadata
    // changes; no user create/delete, no password/sub change.
    if (disconnectedEmail) {
      try {
        const primary = await getUser(guard.user.sub)
        const existing = Array.isArray(primary.app_metadata?.login_alias_emails)
          ? (primary.app_metadata!.login_alias_emails as unknown[]).filter(
              (e): e is string => typeof e === "string",
            )
          : []
        const filtered = existing.filter(
          (e) => e.toLowerCase() !== disconnectedEmail,
        )
        if (filtered.length !== existing.length) {
          await updateUser(guard.user.sub, {
            app_metadata: {
              ...(primary.app_metadata ?? {}),
              login_alias_emails: filtered,
            },
          })
        }
      } catch (aliasErr) {
        console.log(
          "[v0] identity unlink alias cleanup skipped:",
          (aliasErr as Error).message,
        )
      }
    }

    return NextResponse.json({ configured: true, identities })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
