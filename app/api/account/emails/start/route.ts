import { NextResponse } from "next/server"
import { headers } from "next/headers"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser } from "@/lib/auth0-management"
import {
  resolvePasswordlessCreds,
  startEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"

// POST /api/account/emails/start  { email }
// -----------------------------------------
// First step of adding an alternate sign-in email. Emails a 6-digit passcode to
// the address so the person can prove they hold that mailbox (verified in
// /api/account/emails/verify, which then links it onto this account).
//
// PRIVACY — the order of the guards matters. At THIS stage we only reject the
// obvious, cheap cases (the address is already this account's primary, or
// already one of its own linked alternates). For everything else we send the
// code and return a generic response: we do NOT look the address up against the
// wider directory here, so this endpoint never reveals whether an unrelated
// account uses it. That check happens at verify time, AFTER the person has
// proven they own the mailbox.
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let email: string
  try {
    const body = (await request.json()) as { email?: unknown }
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    )
  }

  try {
    // Cheap, non-enumerating rejections: is this already an address on THIS
    // account? (We already know everything about the signed-in user.)
    const me = await getUser(guard.user.sub)
    if ((me.email ?? "").toLowerCase() === email) {
      return NextResponse.json(
        { error: "That's already your primary email address." },
        { status: 409 },
      )
    }
    const alreadyLinked = (me.identities ?? []).some((id) => {
      const idEmail = (id.profileData?.email as string | undefined) ?? ""
      return id.provider === "email" && idEmail.toLowerCase() === email
    })
    if (alreadyLinked) {
      return NextResponse.json(
        { error: "That address is already on your account." },
        { status: 409 },
      )
    }
  } catch (err) {
    return managementErrorResponse(err)
  }

  // Resolve tenant credentials for the caller's region and send the passcode.
  const cookieHeader = (await headers()).get("cookie")
  const creds = resolvePasswordlessCreds(cookieHeader)
  if (!creds) {
    return NextResponse.json(
      { error: "We can't send a code right now. Please try again shortly." },
      { status: 503 },
    )
  }

  try {
    await startEmailPasscode(creds, email)
    // Generic success — identical for every address we didn't cheaply reject,
    // so a caller can't probe which addresses exist elsewhere.
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof PasswordlessError) {
      console.log("[v0] emails/start send failed:", err.message)
      return NextResponse.json(
        { error: "We couldn't send a code right now. Please try again shortly." },
        { status: 502 },
      )
    }
    return managementErrorResponse(err)
  }
}
