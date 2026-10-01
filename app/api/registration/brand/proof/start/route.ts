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
import { brandProofMethodAllowed } from "@/lib/account-model"
import { SITE_BRAND } from "@/lib/site"
import { snapshotPasswordlessSubsFor } from "@/lib/credential-resolver"
import {
  ENROLL_PROOF_COOKIE,
  HANDOFF_TTL_SECONDS,
  encodeHandoff,
  handoffKey,
} from "@/lib/passcode-handoff"
import {
  BRAND_ENROLL_PROOF_FLOW,
  carryForwardProofSnapshot,
} from "@/lib/ownership-otp-proof"

export const runtime = "nodejs"

interface M4Handoff extends Record<string, unknown> {
  primaryUserId: string
  email: string
  brand: string
  proofOptions?: unknown[]
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

  // Codes are only offered when the address is verified on the existing
  // account; never email one the proof route would (rightly) refuse.
  if (!brandProofMethodAllowed(handoff.data.proofOptions, "email-code")) {
    return NextResponse.json(
      { error: "Confirm your email address first, then try again.", reason: "email-unverified" },
      { status: 409 },
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

  // The model4-proof handoff was minted by THIS storefront's brand; never send
  // or carry a proof for a handoff issued on another site.
  if (handoff.data.brand !== SITE_BRAND) {
    return NextResponse.json(
      { error: "That request has expired. Please start again." },
      { status: 401 },
    )
  }

  // Pre-send passwordless snapshot, signed into its own short-lived cookie so
  // the proof route can tell a stub minted by THIS challenge from any
  // pre-existing email-only customer. A resend within the same valid handoff
  // keeps the ORIGINAL snapshot + expiry anchor (see ownership-otp-proof.ts).
  const email = handoff.data.email
  const now = Date.now()
  const carried = carryForwardProofSnapshot({
    priorRaw: request.cookies.get(ENROLL_PROOF_COOKIE)?.value,
    key: handoffKey(),
    flow: BRAND_ENROLL_PROOF_FLOW,
    email,
    brand: SITE_BRAND,
    primaryUserId: handoff.data.primaryUserId,
    now,
  })
  const iat = carried?.iat ?? now
  const preExistingPasswordlessSubs = carried
    ? carried.preExistingPasswordlessSubs
    : await snapshotPasswordlessSubsFor(email)

  try {
    await startEmailPasscode(creds, email)
  } catch (err) {
    if (err instanceof PasswordlessError) {
      return NextResponse.json(
        { error: "We couldn't send a code right now. Please try again." },
        { status: 200 },
      )
    }
    throw err
  }

  const res = NextResponse.json({ status: "code-sent" }, { status: 200 })
  res.cookies.set(
    ENROLL_PROOF_COOKIE,
    encodeHandoff({
      flow: BRAND_ENROLL_PROOF_FLOW,
      email,
      iat,
      brand: SITE_BRAND,
      primaryUserId: handoff.data.primaryUserId,
      preExistingPasswordlessSubs,
    }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(1, HANDOFF_TTL_SECONDS - Math.floor((now - iat) / 1000)),
    },
  )
  return res
}
