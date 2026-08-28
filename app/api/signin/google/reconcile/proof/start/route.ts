import { NextResponse, type NextRequest } from "next/server"
import {
  resolvePasswordlessCreds,
  startEmailPasscode,
} from "@/lib/auth0-passwordless"
import { regionFromCookieHeader } from "@/lib/auth0-regions"
import { journeyCookieName, readJourneyToken } from "@/lib/journey-handoff"
import type { GoogleReconcileHandoff } from "../../route"

// POST /api/signin/google/reconcile/proof/start
// =============================================
// Send a one-time code to the EXISTING account's email so a cold-Google visitor
// can prove they own it (the mailbox-control proof option). The target email is
// read ONLY from the signed handoff cookie minted by the reconcile entry route
// — never from the request body — so a caller cannot redirect the code to an
// address they don't already own. The response is deliberately neutral: it
// never reveals whether an account or mailbox exists.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const GOOGLE_LINK_PURPOSE = "google-link" as const
const NEUTRAL = { ok: true } as const

export async function POST(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie")
  const handoff = readJourneyToken<GoogleReconcileHandoff>(
    GOOGLE_LINK_PURPOSE,
    request.cookies.get(journeyCookieName(GOOGLE_LINK_PURPOSE))?.value,
  )
  // No trustworthy handoff → nothing to send, but stay neutral (no enumeration).
  if (!handoff.ok) return NextResponse.json(NEUTRAL)

  const email = handoff.data.email
  // Defence in depth: only ever send to an email the primary actually owns.
  const owns =
    handoff.data.verifiedEmails
      .map((e) => e.toLowerCase())
      .includes(email.toLowerCase()) || handoff.data.verifiedEmails.length === 0
  if (!owns) return NextResponse.json(NEUTRAL)

  const region = regionFromCookieHeader(cookieHeader)
  const creds = resolvePasswordlessCreds(region)
  if (!creds) return NextResponse.json(NEUTRAL)

  try {
    await startEmailPasscode(creds, email)
  } catch (err) {
    // Log server-side only; the client always sees the same neutral response.
    console.log("[v0] google reconcile otp start failed:", (err as Error).message)
  }
  return NextResponse.json(NEUTRAL)
}
