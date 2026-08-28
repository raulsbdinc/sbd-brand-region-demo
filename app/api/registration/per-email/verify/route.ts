// MODEL 3 (PER-EMAIL) REGISTRATION — VERIFY STEP 2: exchange the one-time code
// ============================================================================
// UK-only, SIGNED-OUT. Verifies the code emailed by verify/start, proving the
// person owns THIS mailbox, and records it in the signed proof handoff. Still
// creates NOTHING in Auth0 — provisioning only happens at the create route once
// every candidate email is proven. Fails closed on a missing/expired/tampered
// handoff, an email that isn't part of this sign-up, or a wrong/expired code.
// The used code is single-use at the tenant, so a replayed code is rejected
// there; the handoff itself is refreshed (never trusts a browser flag).

import { NextResponse, type NextRequest } from "next/server"
import { type Model3RegisterProof } from "@/lib/account-model"
import { verifyEmailPasscode, resolvePasswordlessCreds } from "@/lib/auth0-passwordless"
import {
  mintJourneyToken,
  readJourneyToken,
  journeyCookieName,
  journeyCookieOptions,
} from "@/lib/journey-handoff"

export const runtime = "nodejs"

const norm = (s: string) => s.trim().toLowerCase()

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const otp = typeof body.otp === "string" ? body.otp.trim() : ""
  if (!email || !otp) {
    return NextResponse.json({ error: "Enter the code we emailed you." }, { status: 400 })
  }

  // The signed handoff must exist, be unexpired, and already carry this email as
  // one of the sign-up's candidates. Any mismatch fails closed.
  const cookieName = journeyCookieName("model3-register")
  const handoff = readJourneyToken<Model3RegisterProof>(
    "model3-register",
    request.cookies.get(cookieName)?.value,
  )
  if (!handoff.ok) {
    const expired = handoff.reason === "expired"
    return NextResponse.json(
      { error: expired ? "That request expired. Please start again." : "Please start again." },
      { status: expired ? 410 : 400 },
    )
  }
  const candidates = new Set(
    [handoff.data.primaryEmail, handoff.data.secondaryEmail]
      .filter((e): e is string => typeof e === "string" && e.length > 0)
      .map(norm),
  )
  if (!candidates.has(norm(email))) {
    return NextResponse.json({ error: "Please start again." }, { status: 400 })
  }

  // Prove ownership by exchanging the one-time code. A wrong/expired/used code
  // collapses to the same neutral message.
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    return NextResponse.json(
      { configured: false, reason: "passwordless-not-configured" },
      { status: 200 },
    )
  }
  try {
    await verifyEmailPasscode(creds, norm(email), otp)
  } catch {
    return NextResponse.json({ error: "That code isn't right. Please try again." }, { status: 400 })
  }

  // Record the freshly proven email and re-mint the handoff.
  const verified = new Set((handoff.data.verified ?? []).map(norm))
  verified.add(norm(email))
  const nextProof: Model3RegisterProof = {
    primaryEmail: handoff.data.primaryEmail,
    ...(handoff.data.secondaryEmail ? { secondaryEmail: handoff.data.secondaryEmail } : {}),
    verified: [...verified],
  }
  const allVerified = [...candidates].every((c) => verified.has(c))

  const res = NextResponse.json(
    {
      status: "verified",
      verifiedCount: verified.size,
      requiredCount: candidates.size,
      allVerified,
    },
    { status: 200 },
  )
  res.cookies.set(cookieName, mintJourneyToken("model3-register", nextProof), journeyCookieOptions())
  return res
}
