import { NextResponse, type NextRequest } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import {
  getUser,
  updateUser,
  linkIdentity,
  unlinkIdentity,
  ManagementError,
} from "@/lib/auth0-management"
import { resolvePasswordChangeCoordinates } from "@/lib/credential-resolver"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { passwordRealmExchange } from "@/lib/auth0-password-grant"
import {
  mapPasswordUpdateError,
  planPasswordUpdate,
  validateNewPassword,
  type PasswordChangeSelector,
  type PasswordUpdatePlan,
  type RelinkPasswordUpdatePlan,
} from "@/lib/password-change"

// POST /api/account/password-change
// =================================
// IN-SITE (signed-in) self-service password CHANGE. Unlike /password-reset
// (which mints an Auth0-hosted change TICKET), this changes the password inside
// the storefront: it verifies the CURRENT password against the EXACT target
// email/connection via the password-realm grant, then PATCHes ONLY that one
// database identity through the Management API.
//
// SECURITY MODEL:
//   • Requires a real Auth0 session (requireAccountUser).
//   • Same-origin only (Sec-Fetch-Site / Origin), consistent with a mutating
//     account route — a cross-site page can't drive it.
//   • The browser sends a SELECTOR, never coordinates:
//        { scope: "shared" } | { bindingId: "<id>" }
//     The exact connection + database user_id to change is derived SERVER-SIDE
//     from the signed-in account's own bindings/identities and allow-listed by
//     the pure planner. A client can never target another account, a social
//     identity, or an unowned/unconfigured credential.
//   • Wrong current password → generic auth failure (no enumeration).
//   • Auth0 password-policy failures are mapped to a safe hint.
//   • No password is ever logged or written to metadata.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const GENERIC_AUTH_ERROR = "That current password isn't right."

/** Same-origin gate consistent with other mutating routes. */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site")
  // Modern browsers: same-origin / same-site are fine; cross-site is refused.
  if (site) return site === "same-origin" || site === "same-site" || site === "none"
  // Fallback for clients without the header: compare Origin to the host.
  const origin = request.headers.get("origin")
  if (!origin) return true // non-browser / same-origin fetch with no Origin
  try {
    const originHost = new URL(origin).host
    const host = request.headers.get("host")
    return Boolean(host) && originHost === host
  } catch {
    return false
  }
}

function parseSelector(body: unknown): PasswordChangeSelector | null {
  if (typeof body !== "object" || body === null) return null
  const b = body as Record<string, unknown>
  if (b.scope === "shared") return { scope: "shared" }
  if (typeof b.bindingId === "string" && b.bindingId.trim()) {
    return { bindingId: b.bindingId.trim() }
  }
  return null
}

export async function POST(request: NextRequest) {
  // 1) Same-origin protection (before any work or auth disclosure).
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  // 2) Require an authenticated session + configured Management API.
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  // 3) Parse the request: a target selector + the three passwords.
  let selector: PasswordChangeSelector | null = null
  let currentPassword = ""
  let newPassword = ""
  try {
    const body = (await request.json()) as Record<string, unknown>
    selector = parseSelector(body)
    currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : ""
    newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  if (!selector) {
    return NextResponse.json(
      { error: "That credential can't be changed." },
      { status: 400 },
    )
  }
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Enter your current and new password." },
      { status: 400 },
    )
  }
  // Enforce the baseline policy server-side too (never trust the client gate).
  if (!validateNewPassword(newPassword).ok) {
    return NextResponse.json(
      {
        error:
          "That new password doesn't meet the password policy. Choose a stronger one.",
        code: "weak-password",
      },
      { status: 400 },
    )
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "Choose a new password that's different from your current one." },
      { status: 400 },
    )
  }

  // 4) Region tenant credentials (same resolution the rest of the app uses).
  const region = regionFromCookieHeader(request.headers.get("cookie"))
  const { domain, clientId, clientSecret } = resolveRegionAuthConfig(region)
  if (!domain || !clientId || !clientSecret) {
    return managementErrorResponse(
      new ManagementError("Auth not configured", 502),
    )
  }

  try {
    // 5) Derive the EXACT target from the signed-in account, server-side. The
    //    browser's selector is validated against this account's own bindings +
    //    linked identities; a social/unowned/unconfigured target returns null.
    const primaryUser = await getUser(guard.user.sub)
    const target = resolvePasswordChangeCoordinates(primaryUser, selector)
    if (!target) {
      // Neutral rejection — never reveal which rule failed or whether an id
      // exists. Fails closed on missing / ambiguous / unowned / social targets.
      return NextResponse.json(
        { error: "That credential can't be changed." },
        { status: 400 },
      )
    }

    // 6) Verify the CURRENT password against the EXACT target email + connection
    //    using the password-realm grant (server-to-server; the secret never
    //    reaches the browser). A null result means the current password is
    //    wrong (or the account is blocked) → one generic auth failure.
    const firstHop = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")[0]
      .trim()
    const verified = await passwordRealmExchange({
      domain,
      clientId,
      clientSecret,
      firstHop,
      username: target.email,
      password: currentPassword,
      connectionKey: target.connectionKey,
    })
    if (!verified) {
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 })
    }

    // 7) Update ONLY that database identity's password through the Management
    //    API, hitting the EXACT identity and nothing else.
    //
    //    A connection-scoped PATCH on the primary (`{ password, connection }`)
    //    is ambiguous whenever the account has MORE THAN ONE identity on that
    //    connection — which is exactly the per-email model (emails A and B are
    //    both linked on the shared per-email connection). Auth0 then updates
    //    whichever identity it matches first (the primary/first), so the
    //    selected email's password is never changed and another identity's is
    //    silently overwritten.
    //
    //    So a LINKED SECONDARY identity is changed by targeting its exact
    //    database user_id: unlink it (restoring it as a standalone Management
    //    user), PATCH that user, then relink it — with rollback so a failure
    //    never leaves the account split. Only the account's own ROOT identity
    //    (shared Models 1-2, or a standalone per-email/brand account) uses the
    //    direct connection-scoped PATCH, unchanged. A social identity is never a
    //    target. No password is logged or stored anywhere but the directory.
    const plan = planPasswordUpdate({
      auth0UserId: target.auth0UserId,
      managementUserId: target.managementUserId,
      isLinkedSecondary: target.isLinkedSecondary,
      connectionName: target.connectionName,
      connectionId: target.connectionId,
    })
    try {
      await applyPasswordUpdate(plan, newPassword)
    } catch (err) {
      // Map Auth0 password-policy rejections to a safe hint; anything else
      // collapses to a neutral failure. Never surface the upstream body.
      const status =
        err instanceof ManagementError ? err.status : undefined
      const message = err instanceof Error ? err.message : undefined
      const friendly = mapPasswordUpdateError({ status, message })
      console.log(
        "[v0] password-change update rejected:",
        status ?? "?",
        message ?? "unknown",
      )
      const httpStatus = status === 400 ? 400 : 502
      return NextResponse.json({ error: friendly }, { status: httpStatus })
    }

    // 8) Success. Report only the non-secret credential label + email so the
    //    UI can confirm exactly which password changed.
    return NextResponse.json({
      ok: true,
      credential: { label: target.label, email: target.email },
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

/** Relink body for restoring a temporarily-unlinked secondary identity. */
function relinkBody(plan: RelinkPasswordUpdatePlan) {
  return {
    provider: plan.provider,
    user_id: plan.secondaryUserId,
    ...(plan.connectionId ? { connection_id: plan.connectionId } : {}),
  } as const
}

/**
 * Execute a resolved {@link PasswordUpdatePlan} so the write lands on EXACTLY
 * one database identity.
 *
 * - `direct`: an unambiguous root identity — PATCH it with `{ password,
 *   connection }` (unchanged legacy behavior for shared Models 1-2 and
 *   standalone per-email/brand accounts).
 * - `relink`: a linked secondary — UNLINK it so it becomes a standalone
 *   Management user, PATCH that user's own id (never ambiguous), then RELINK it.
 *   If the PATCH fails we relink first so the account is never left split; if
 *   the relink itself fails we retry once before surfacing the error.
 */
async function applyPasswordUpdate(
  plan: PasswordUpdatePlan,
  newPassword: string,
): Promise<void> {
  if (plan.mode === "direct") {
    await updateUser(plan.patchUserId, {
      password: newPassword,
      connection: plan.connectionName,
    })
    return
  }

  // relink mode — detach the exact secondary identity so it is standalone.
  await unlinkIdentity(plan.primaryUserId, plan.provider, plan.secondaryUserId)

  try {
    await updateUser(plan.secondaryPatchUserId, {
      password: newPassword,
      connection: plan.connectionName,
    })
  } catch (patchErr) {
    // The password write failed: restore the linkage before surfacing the
    // error so we never leave the account permanently split.
    try {
      await linkIdentity(plan.primaryUserId, relinkBody(plan))
    } catch (restoreErr) {
      console.log(
        "[v0] password-change relink-after-patch-failure failed:",
        restoreErr instanceof Error ? restoreErr.message : "unknown",
      )
    }
    throw patchErr
  }

  // Password changed on the exact identity — now re-attach it. Retry once.
  try {
    await linkIdentity(plan.primaryUserId, relinkBody(plan))
  } catch {
    await linkIdentity(plan.primaryUserId, relinkBody(plan))
  }
}
