import { NextResponse, type NextRequest } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser, ManagementError } from "@/lib/auth0-management"
import { resolvePasswordChangeCoordinates } from "@/lib/credential-resolver"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { passwordRealmExchange } from "@/lib/auth0-password-grant"
import {
  mapPasswordUpdateError,
  validateNewPassword,
  type PasswordChangeSelector,
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
    //    API. Patching by the resolved identity user_id + connection name keeps
    //    a linked SECONDARY identity (case 3/4) targeted precisely and never
    //    touches a social identity. No password is logged or stored anywhere
    //    but the directory.
    try {
      await updateUser(target.auth0UserId, {
        password: newPassword,
        connection: target.connectionName,
      })
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
