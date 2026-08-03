// ACCOUNT ROUTE GUARD (server-only)
// =================================
// Shared helper for every /api/account/* route. It enforces the two invariants
// that keep the Management API safe to expose to the browser:
//
//   1. There must be a real Auth0 session (the user is signed in).
//   2. Every Management API call is scoped to THAT user's own `sub` — a route
//      never accepts a user id from the client, so one user can never read or
//      mutate another user's account.
//
// Routes call `requireAccountUser()`. On success they get the signed-in user's
// `sub` (and claims). On failure they get a ready-to-return NextResponse.

import "server-only"
import { NextResponse } from "next/server"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { isManagementConfigured, getLoginMethods } from "@/lib/auth0-management"

export interface AccountUser {
  sub: string
  claims: Record<string, unknown>
}

type GuardResult =
  | { ok: true; user: AccountUser }
  | { ok: false; response: NextResponse }

/**
 * Resolve and authorize the signed-in user for an account route.
 *
 * @param opts.requireManagement  When true (the default for mutating routes),
 *   a 200 `{ configured: false }` is returned if the Management API env vars are
 *   absent, so the client can transparently fall back to its Demo simulation.
 */
export async function requireAccountUser(opts?: {
  requireManagement?: boolean
}): Promise<GuardResult> {
  const requireManagement = opts?.requireManagement ?? true

  // No real Auth0 integration at all → there is no real account to manage.
  if (!isAuthConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { configured: false, reason: "auth-not-configured" },
        { status: 200 },
      ),
    }
  }

  let session: Awaited<ReturnType<typeof auth0.getSession>> = null
  try {
    session = await auth0.getSession()
  } catch {
    session = null
  }

  const sub = session?.user?.sub as string | undefined
  if (!session?.user || !sub) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    }
  }

  if (requireManagement && !isManagementConfigured()) {
    // Signed in, but the Management API isn't wired up. Tell the client to use
    // its Demo behaviour instead of erroring.
    return {
      ok: false,
      response: NextResponse.json(
        { configured: false, reason: "management-not-configured" },
        { status: 200 },
      ),
    }
  }

  return {
    ok: true,
    user: { sub, claims: session.user as Record<string, unknown> },
  }
}

/**
 * Lockout guard for removing a sign-in method. A consumer must always retain at
 * least one way to access their account, so removal routes call this first.
 * Returns a ready-to-return 409 response if the user has only one method left,
 * otherwise `null` (clear to proceed). Enforced server-side so the rule holds
 * even if the client UI is bypassed.
 */
export async function ensureNotLastLoginMethod(
  sub: string,
): Promise<NextResponse | null> {
  const { total } = await getLoginMethods(sub)
  if (total <= 1) {
    return NextResponse.json(
      {
        error:
          "This is your only way to sign in. Add another method before removing this one.",
        code: "last-login-method",
      },
      { status: 409 },
    )
  }
  return null
}

/** Normalize a thrown ManagementError (or anything) into a JSON response. */
export function managementErrorResponse(err: unknown): NextResponse {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status) || 502
      : 502
  const message = err instanceof Error ? err.message : "Management API error"
  // Don't leak full upstream bodies to the client; log server-side instead.
  console.log("[v0] account route management error:", message)
  return NextResponse.json(
    { error: "The directory service rejected the request.", status },
    { status: status >= 400 && status < 600 ? status : 502 },
  )
}
