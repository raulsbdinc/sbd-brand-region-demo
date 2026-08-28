// MODEL 4 CROSS-BRAND PROOF — send a one-time email code
// ======================================================
// Only reachable with a valid model4-proof handoff cookie (minted by
// /api/registration/brand when an existing account was detected). Emails a
// one-time code to the OWNED address so the customer can prove they hold the
// existing account before the second brand is linked. Password proof needs no
// start step. Responses are deliberately neutral.

import { NextResponse, type NextRequest } from "next/server"
import {
  journeyCookieName,
  readJourneyToken,
} from "@/lib/journey-handoff"
import {
  resolvePasswordlessCreds,
  startEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"

export const runtime = "nodejs"

interface M4Handoff extends Record<string, unknown> {
  primaryUserId: string
  email: string
  brand: string
}

export async function POST(request: NextRequest) {
  const cookieName = journeyCookieName("model4-proof")
  const handoff = readJourneyToken<M4Handoff>(
    "model4-proof",
    request.cookies.get(cookieName)?.value,
  )
  if (!handoff.ok) {
    // Expired or tampered handoff — make the customer restart registration.
    return NextResponse.json(
      { error: "That request has expired. Please start again." },
      { status: 401 },
    )
  }

  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    // Misconfigured deployment — neutral soft error, never a hint.
    return NextResponse.json(
      { error: "We couldn't send a code right now. Please try again." },
      { status: 200 },
    )
  }

  try {
    await startEmailPasscode(creds, handoff.data.email)
  } catch (err) {
    if (err instanceof PasswordlessError) {
      return NextResponse.json(
        { error: "We couldn't send a code right now. Please try again." },
        { status: 200 },
      )
    }
    throw err
  }

  return NextResponse.json({ status: "code-sent" }, { status: 200 })
}
