// MODEL 3 COMPLETION — STEP 2: verify the code and link the second email
// ======================================================================
// Authenticated. Verifies the one-time code emailed in step 1 (proving mailbox
// ownership), re-checks the SAME signed handoff (so the address can't be swapped
// after the code was sent), re-runs the pure planner with ownership proven, then
// creates + links the second per-email identity under the primary. Fails closed
// on a missing/expired/mismatched handoff, a wrong code, or any partial failure
// (the executor rolls back). The connection is resolved server-side throughout.

import { NextResponse, type NextRequest } from "next/server"
import { SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import {
  readBindings,
  connectionIdForKey,
  guardAddEmailOwnership,
  purgeTransientEmailStub,
} from "@/lib/credential-resolver"
import { planModel3Completion } from "@/lib/account-model"
import { requireAccountUser } from "@/lib/account-guard"
import { getUser } from "@/lib/auth0-management"
import { verifyEmailPasscode, resolvePasswordlessCreds } from "@/lib/auth0-passwordless"
import { executePerEmailLink } from "@/lib/model-registration"
import { realManagementDeps } from "@/lib/model-registration-deps"
import { readJourneyToken, journeyCookieName, journeyCookieOptions } from "@/lib/journey-handoff"

export const runtime = "nodejs"

interface M3Handoff extends Record<string, unknown> {
  sub: string
  email: string
}

export async function POST(request: NextRequest) {
  const guard = await requireAccountUser({ requireManagement: true })
  if (!guard.ok) return guard.response
  const sub = guard.user.sub

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const otp = typeof body.otp === "string" ? body.otp.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!email || !otp || !password) {
    return NextResponse.json({ error: "Enter the code and a password." }, { status: 400 })
  }

  // Re-check the signed handoff: it must exist, be unexpired, and bind THIS
  // signed-in user to THIS email. Any mismatch fails closed.
  const cookieName = journeyCookieName("model3-complete")
  const handoff = readJourneyToken<M3Handoff>(
    "model3-complete",
    request.cookies.get(cookieName)?.value,
  )
  if (!handoff.ok) {
    const expired = handoff.reason === "expired"
    return NextResponse.json(
      { error: expired ? "That request expired. Please start again." : "Please start again." },
      { status: expired ? 410 : 400 },
    )
  }
  if (handoff.data.sub !== sub || handoff.data.email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Please start again." }, { status: 400 })
  }

  // Prove ownership by exchanging the one-time code.
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    return NextResponse.json({ configured: false, reason: "passwordless-not-configured" }, { status: 200 })
  }
  try {
    await verifyEmailPasscode(creds, email, otp)
  } catch {
    return NextResponse.json({ error: "That code isn't right. Please try again." }, { status: 400 })
  }

  // The emailed code was proof only — the second per-email credential is a fresh
  // DB identity created below, so this transient passwordless stub is disposable
  // and nothing downstream references it. Purge it now so a successful link (or
  // the ownership-guard/link-failure paths) never leaves an orphan email|… user
  // behind. purgeTransientEmailStub only deletes all-passwordless standalone
  // records, so the signed-in primary (a real DB identity) is never touched.
  await purgeTransientEmailStub(email)

  // Canonical-ownership guard. Mailbox control is now proven, so this is not an
  // enumeration oracle. The submitted address may already belong to a DIFFERENT
  // canonical customer — linking it would silently attach a second person's
  // mailbox to this account. Allow ONLY when every existing owner resolves to
  // THIS account (unowned, or the same canonical parent — the Model 4 cross-brand
  // / partial-retry case). On rejection, purge the transient passwordless stub
  // the code step minted so no standalone/linked passwordless identity is left
  // behind, and return neutral copy.
  const ownership = await guardAddEmailOwnership({ email, currentUserId: sub })
  if (!ownership.ok) {
    const res = NextResponse.json(
      { error: ownership.error },
      { status: ownership.status },
    )
    res.cookies.set(cookieName, "", { ...journeyCookieOptions(), maxAge: 0 })
    return res
  }

  // Re-plan with ownership proven; the connection is resolved server-side.
  let existingBindings
  try {
    existingBindings = readBindings(await getUser(sub))
  } catch {
    return NextResponse.json(
      { error: "We couldn't complete that right now. Please try again." },
      { status: 502 },
    )
  }
  const plan = planModel3Completion({
    market: SITE_MARKET,
    primaryUserId: sub,
    existingBindings,
    email,
    ownershipVerified: true,
    connectionNames: resolveConnectionNames(),
  })
  if (!plan.ok) {
    return NextResponse.json({ error: "That email can't be added to this account." }, { status: 409 })
  }

  const outcome = await executePerEmailLink(
    {
      primaryUserId: plan.primaryUserId,
      connectionName: plan.connectionName,
      connectionId: connectionIdForKey("per-email"),
      email: plan.email,
      password,
    },
    realManagementDeps,
  )
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  const res = NextResponse.json({ status: "linked", credentialCount: outcome.credentials.length }, { status: 200 })
  // One-time: clear the handoff so it can't be replayed.
  res.cookies.set(cookieName, "", { ...journeyCookieOptions(), maxAge: 0 })
  return res
}
