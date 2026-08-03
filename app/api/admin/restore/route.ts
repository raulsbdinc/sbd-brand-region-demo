// ADMIN ACCOUNT RESTORE (server-only)
// ===================================
// Undoes a SOFT delete (POST /api/account/delete), which blocks the Auth0 user
// and records an erasure receipt in app_metadata. Restoring unblocks the user
// and clears the deletion flags, honouring the reversible grace window promised
// by the erasure model (lib/erasure.ts, ERASURE_GRACE_PERIOD_DAYS).
//
// WHY ADMIN-GATED (not self-service): a blocked user cannot authenticate, so
// there is no session to scope to. This route is therefore gated by a shared
// admin secret (ADMIN_RESTORE_SECRET) sent in the `x-admin-secret` header,
// rather than requireAccountUser(). It resolves the target by user id or email
// and never trusts anything else from the caller.

import { NextResponse } from "next/server"
import { isManagementConfigured } from "@/lib/auth0-management"
import {
  getUser,
  getUsersByEmail,
  updateUser,
  type Auth0User,
} from "@/lib/auth0-management"
import { managementErrorResponse } from "@/lib/account-guard"

export const dynamic = "force-dynamic"

/** Constant-time-ish secret check. Returns a response to short-circuit, or null. */
function checkAdmin(request: Request): NextResponse | null {
  const expected = process.env.ADMIN_RESTORE_SECRET
  if (!expected) {
    // Not configured → tell the client so the UI can explain how to enable it.
    return NextResponse.json(
      { configured: false, reason: "restore-not-configured" },
      { status: 200 },
    )
  }
  const provided = request.headers.get("x-admin-secret") ?? ""
  if (provided !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}

/** Trim an Auth0 user to the safe fields the admin UI needs. */
function summarize(u: Auth0User) {
  const meta = (u.app_metadata ?? {}) as Record<string, unknown>
  return {
    user_id: u.user_id,
    email: u.email,
    name: u.name,
    blocked: Boolean(u.blocked),
    deletionRequested: Boolean(meta.deletion_requested),
    deletionRequestedAt: (meta.deletion_requested_at as string) ?? null,
  }
}

/**
 * Resolve the single target user from an id or email. Returns either the user
 * or a ready-to-return error response.
 */
async function resolveTarget(body: {
  userId?: string
  email?: string
}): Promise<{ user: Auth0User } | { response: NextResponse }> {
  if (body.userId) {
    const user = await getUser(body.userId)
    return { user }
  }
  if (body.email) {
    const matches = await getUsersByEmail(body.email)
    if (matches.length === 0) {
      return {
        response: NextResponse.json(
          { error: "No account found for that email." },
          { status: 404 },
        ),
      }
    }
    // Prefer a blocked match; if several are blocked, require an explicit id.
    const blocked = matches.filter((m) => m.blocked)
    const pool = blocked.length > 0 ? blocked : matches
    if (pool.length > 1) {
      return {
        response: NextResponse.json(
          {
            error:
              "Multiple accounts match that email. Restore by user id instead.",
            candidates: pool.map(summarize),
          },
          { status: 409 },
        ),
      }
    }
    return { user: pool[0] }
  }
  return {
    response: NextResponse.json(
      { error: "Provide an email or user id." },
      { status: 400 },
    ),
  }
}

export async function POST(request: Request) {
  const denied = checkAdmin(request)
  if (denied) return denied

  if (!isManagementConfigured()) {
    return NextResponse.json(
      { configured: false, reason: "management-not-configured" },
      { status: 200 },
    )
  }

  let body: { userId?: string; email?: string; lookup?: boolean } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // fall through to validation
  }

  try {
    const resolved = await resolveTarget(body)
    if ("response" in resolved) return resolved.response
    const target = resolved.user

    // Lookup-only: report status without mutating.
    if (body.lookup) {
      return NextResponse.json({ configured: true, user: summarize(target) })
    }

    if (!target.blocked && !target.app_metadata?.deletion_requested) {
      return NextResponse.json({
        configured: true,
        restored: false,
        alreadyActive: true,
        user: summarize(target),
      })
    }

    // Unblock + clear the soft-delete flags. Setting app_metadata keys to null
    // removes them in Auth0, so the erasure receipt no longer marks the account
    // for deletion.
    const updated = await updateUser(target.user_id, {
      blocked: false,
      app_metadata: {
        deletion_requested: null,
        deletion_requested_at: null,
        deletion_channel: null,
        erasure: null,
        restored_at: new Date().toISOString(),
      },
    })

    return NextResponse.json({
      configured: true,
      restored: true,
      user: summarize(updated),
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
