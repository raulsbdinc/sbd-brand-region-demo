import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"

// POST /api/account/emails/primary  { email }
// ---------------------------------------------------------------------------
// "Make primary" — a DESIGNATION change, not a data migration. It records which
// of the account's OWN verified emails should be shown as primary, and makes
// sure every listed email can actually sign in with the one password.
//
// ONE ACCOUNT, ONE MAU. This never creates or deletes a user, never changes the
// password, and never touches the sbd-eu database identity's email or the
// immutable `sub`. The password stays on the database identity (whose address
// remains the account root email); we only ever write app_metadata:
//   - primary_email:      the chosen display primary (lowercased)
//   - login_alias_emails: every account email EXCEPT the database root, so each
//                         one resolves to the single password at sign-in.
//
// Changing the token's email claim to follow the displayed primary would need a
// post-login Action (out of scope) — this feature changes the profile surface.
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Generic, non-enumerating rejection — identical whether the address is
// malformed or simply not one of the caller's own verified emails.
const NOT_YOUR_EMAIL =
  "That isn't one of your verified email addresses, so it can't be made primary."

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let email: string
  try {
    const body = (await request.json()) as { email?: unknown }
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  } catch {
    return NextResponse.json({ error: NOT_YOUR_EMAIL }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: NOT_YOUR_EMAIL }, { status: 400 })
  }

  try {
    const user = await getUser(guard.user.sub)

    // The account's OWN verified emails. Match the existing alias code's notion
    // of "verified": a root email with email_verified === true, plus every
    // linked "email" identity whose profileData.email_verified !== false (the
    // add-email flow only links after mailbox proof, so linked === verified),
    // plus every linked "google-oauth2" identity's verified email — a connected
    // Google address is a first-class account email that can be made primary.
    const rootEmail = user.email?.toLowerCase() ?? null
    const rootVerified = Boolean(rootEmail) && user.email_verified === true

    const linkedVerified = (user.identities ?? [])
      .filter((id) => id.provider === "email" || id.provider === "google-oauth2")
      .map((id) => ({
        email: (id.profileData?.email as string | undefined)?.toLowerCase(),
        verified: id.profileData?.email_verified !== false,
      }))
      .filter((e): e is { email: string; verified: boolean } =>
        Boolean(e.email) && e.verified,
      )
      .map((e) => e.email)

    const ownVerified = new Set<string>([
      ...(rootVerified && rootEmail ? [rootEmail] : []),
      ...linkedVerified,
    ])

    // You may only make one of YOUR OWN verified emails primary. Same generic
    // rejection as a malformed address — never reveal whether an address exists.
    if (!ownVerified.has(email)) {
      return NextResponse.json({ error: NOT_YOUR_EMAIL }, { status: 400 })
    }

    // Backfill: every account email EXCEPT the current database ROOT email must
    // be a login alias, so every row shown in the list signs in with the one
    // password. This picks up older alternates added before aliases were
    // persisted. The root email needs no alias entry — it signs in directly.
    const existingAliases = Array.isArray(user.app_metadata?.login_alias_emails)
      ? (user.app_metadata!.login_alias_emails as unknown[]).filter(
          (e): e is string => typeof e === "string",
        )
      : []
    const mergedAliases = Array.from(
      new Set([
        ...existingAliases.map((e) => e.toLowerCase()),
        ...[...ownVerified].filter((e) => e !== rootEmail),
      ]),
    )

    // PRESERVE everything else in app_metadata (sbd_sites, etc). Only
    // primary_email and login_alias_emails change.
    const user2 = await updateUser(guard.user.sub, {
      app_metadata: {
        ...(user.app_metadata ?? {}),
        primary_email: email,
        login_alias_emails: mergedAliases,
      },
    })

    const primaryEmail =
      (user2.app_metadata?.primary_email as string | undefined) ?? email
    return NextResponse.json({ ok: true, primaryEmail })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
