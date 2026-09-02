import { NextResponse } from "next/server"
import { headers } from "next/headers"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import {
  getUser,
  linkIdentity,
  updateUser,
  ManagementError,
} from "@/lib/auth0-management"
import { guardAddEmailOwnership } from "@/lib/credential-resolver"
import {
  resolvePasswordlessCreds,
  verifyEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"

// POST /api/account/emails/verify  { email, code }
// ------------------------------------------------
// Second step of adding an alternate sign-in email. The person has just proven
// they hold the mailbox by entering the passcode; we exchange it for the NEW
// secondary identity and LINK it onto this account so the alternate becomes a
// real sign-in identifier for the same person.
//
// GUARD ORDER (privacy): only NOW — after mailbox ownership is proven — do we
// look the address up against the wider directory. If it already signs in to a
// DIFFERENT account on our database connection, we refuse the link and say so
// plainly. That is not an enumeration leak (they just proved they own the
// mailbox) and it is the correct outcome: one sign-in address must resolve to
// exactly one person.
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Shown when the address is already a sign-in identifier for another account.
const IN_USE_ELSEWHERE =
  "That address is already used to sign in to another Stanley Black & Decker account, so it can't also sign in to this one. Sign in to that account to manage it, or use a different address."

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let email: string
  let code: string
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown }
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    code = typeof body.code === "string" ? body.code.trim() : ""
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  if (!EMAIL_RE.test(email) || !/^\d{4,8}$/.test(code)) {
    return NextResponse.json(
      { error: "Enter the code we emailed you." },
      { status: 400 },
    )
  }

  // STEP b — exchange the passcode for the new secondary identity.
  const cookieHeader = (await headers()).get("cookie")
  const creds = resolvePasswordlessCreds(cookieHeader)
  if (!creds) {
    return NextResponse.json(
      { error: "We can't verify this right now. Please try again shortly." },
      { status: 503 },
    )
  }

  let secondary
  try {
    secondary = await verifyEmailPasscode(creds, email, code)
  } catch (err) {
    if (err instanceof PasswordlessError && err.kind === "otp") {
      return NextResponse.json(
        { error: "That code isn't right or has expired. Please try again." },
        { status: 400 },
      )
    }
    console.log("[v0] emails/verify exchange failed:", (err as Error).message)
    return NextResponse.json(
      { error: "We couldn't verify that code. Please try again shortly." },
      { status: 502 },
    )
  }

  // If the passcode somehow resolved to this very account, there's nothing to
  // link — just report success.
  if (secondary.sub === guard.user.sub) {
    try {
      const me = await getUser(guard.user.sub)
      return NextResponse.json({ ok: true, identities: me.identities ?? [] })
    } catch (err) {
      return managementErrorResponse(err)
    }
  }

  // STEP (guard) — CENTRALIZED canonical-ownership guard. Mailbox control is now
  // proven, so this is not an enumeration oracle. Refuse the link unless every
  // existing owner of the normalized address resolves to THIS account. This is
  // the SAME deterministic enumerate+hydrate guard the per-email completion
  // route uses — it inspects every Auth0 identity's email (including a linked
  // SOCIAL identity's profileData.email, which getUsersByEmail cannot see), so a
  // foreign account's linked Google address is correctly rejected here. On
  // rejection it also purges the transient passwordless stub the code step
  // minted, so no standalone/linked passwordless identity is left behind.
  const ownership = await guardAddEmailOwnership({
    email,
    currentUserId: guard.user.sub,
  })
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  // STEP c — link the proven secondary identity onto the primary account.
  try {
    const identities = await linkIdentity(guard.user.sub, {
      provider: secondary.provider,
      user_id: secondary.userId,
    })

    // STEP d — record this alternate on the PRIMARY so password sign-in can
    // resolve it later. The alternate is now a linked "email" identity whose
    // address is NOT the primary's root email, and Auth0's users-by-email +
    // search index do NOT return linked-identity emails — so the ONLY reliably
    // searchable place to find it is app_metadata, which we control. We append
    // the lowercased address to a deduped `login_alias_emails` array, keeping
    // any existing entries. Best-effort: the link (what the user asked for)
    // already succeeded, so a failure here must NOT fail the request.
    try {
      const primary = await getUser(guard.user.sub)
      const existing = primary.app_metadata?.login_alias_emails
      const list = Array.isArray(existing)
        ? existing.filter((e): e is string => typeof e === "string")
        : []
      const merged = Array.from(
        new Set([...list.map((e) => e.toLowerCase()), email]),
      )
      if (merged.length !== list.length) {
        await updateUser(guard.user.sub, {
          app_metadata: {
            ...(primary.app_metadata ?? {}),
            login_alias_emails: merged,
          },
        })
      }
    } catch (metaErr) {
      console.log(
        "[v0] emails/verify login-alias persist skipped:",
        (metaErr as Error).message,
      )
    }

    return NextResponse.json({ ok: true, identities })
  } catch (err) {
    // A 400/409 here almost always means the address is attached elsewhere —
    // fall back to the same plain message rather than a raw directory error.
    if (
      err instanceof ManagementError &&
      (err.status === 400 || err.status === 409)
    ) {
      return NextResponse.json({ error: IN_USE_ELSEWHERE }, { status: 409 })
    }
    return managementErrorResponse(err)
  }
}
