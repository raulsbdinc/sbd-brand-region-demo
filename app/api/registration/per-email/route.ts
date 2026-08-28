// MODEL 3 (PER-EMAIL) REGISTRATION — server route (create, code-consumed)
// ========================================================================
// UK-only. Creates the primary per-email identity and, when a second email +
// password are part of the sign-up, creates and links that too — all on the
// per-email connection, under ONE primary Auth0 profile, with one coherent
// binding each.
//
// SECURITY MODEL — no account before proof, and proof that can't be replayed:
//   * The emails being registered are read ONLY from the signed, purpose-bound
//     "model3-register" handoff cookie, never from the request body. A missing,
//     expired, or tampered cookie decodes to null and we fail closed.
//   * Ownership is proven by CONSUMING a fresh one-time code for EVERY email at
//     the IdP in THIS request (registerModel3WithProof → verifyEmailPasscode →
//     Auth0's passwordless OTP grant, which single-uses the code). Because the
//     tenant consumes each code, a copied cookie or a replayed code cannot mint
//     anything — the consumption, not any cookie state, is the boundary.
//   * Only when every code is consumed does provisioning run. A collected
//     password is NEVER treated as proof.
// The body carries only passwords + one-time codes (by role); when the second
// email is skipped the client is told the authenticated completion journey
// (POST /api/registration/per-email/complete) can add it later.

import { NextResponse, type NextRequest } from "next/server"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import { connectionIdForKey } from "@/lib/credential-resolver"
import {
  planModel3Registration,
  type Model3RejectReason,
  type Model3RegisterBinding,
} from "@/lib/account-model"
import { registerModel3WithProof } from "@/lib/model-registration"
import { realManagementDeps } from "@/lib/model-registration-deps"
import { isManagementConfigured } from "@/lib/auth0-management"
import { verifyEmailPasscode, resolvePasswordlessCreds } from "@/lib/auth0-passwordless"
import { readJourneyToken, journeyCookieName, journeyCookieOptions } from "@/lib/journey-handoff"

export const runtime = "nodejs"

/** Map a pure-planner rejection to a neutral client response. */
function planRejection(reason: Model3RejectReason): NextResponse {
  switch (reason) {
    case "not-configured":
      // Signed-out equivalent of the account routes' fallback: let the client
      // show its Demo behaviour instead of erroring.
      return NextResponse.json({ configured: false, reason: "not-configured" }, { status: 200 })
    case "market-unavailable":
      return NextResponse.json({ error: "That option isn't available here." }, { status: 400 })
    case "duplicate-email":
      return NextResponse.json({ error: "Use two different email addresses." }, { status: 400 })
    default:
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }

  // Passwords + one-time codes come from the body (by role). Emails do NOT —
  // they are bound server-side by the signed handoff, so the browser can't
  // point a proven code at a different address.
  const primaryPassword = str(body.primaryPassword)
  const secondaryPassword = str(body.secondaryPassword)
  const primaryOtp = str(body.primaryOtp)
  const secondaryOtp = str(body.secondaryOtp)

  // The email set is authoritative from the signed, purpose-bound cookie.
  const cookieName = journeyCookieName("model3-register")
  const handoff = readJourneyToken<Model3RegisterBinding>(
    "model3-register",
    request.cookies.get(cookieName)?.value,
  )
  if (!handoff.ok) {
    // Missing / expired / tampered / wrong-purpose: nothing is touched.
    const expired = handoff.reason === "expired"
    return NextResponse.json(
      { error: "Please start again and confirm your email address." },
      { status: expired ? 410 : 403 },
    )
  }
  const boundEmails = {
    primaryEmail: handoff.data.primaryEmail,
    secondaryEmail: handoff.data.secondaryEmail,
  }

  if (!primaryPassword) {
    return NextResponse.json({ error: "Enter a password." }, { status: 400 })
  }

  // Plan the model PURELY from the BOUND emails: validates them, gates to UK,
  // resolves the per-email connection from env. Never trusts the body for any
  // of this.
  const plan = planModel3Registration(
    { primaryEmail: boundEmails.primaryEmail, secondaryEmail: boundEmails.secondaryEmail || undefined },
    {
      market: SITE_MARKET,
      siteBrand: SITE_BRAND,
      connectionNames: resolveConnectionNames(),
    },
  )
  if (!plan.ok) return planRejection(plan.reason)

  // If the Management API isn't wired up, the executor can't run — surface the
  // same "configured: false" the client already knows how to simulate.
  if (!isManagementConfigured()) {
    return NextResponse.json({ configured: false, reason: "management-not-configured" }, { status: 200 })
  }

  // A second email needs its own password.
  if (plan.hasSecondary && !secondaryPassword) {
    return NextResponse.json(
      { error: "Enter a password for the second email." },
      { status: 400 },
    )
  }

  // Passwordless must be configured so we can CONSUME each code at the IdP.
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    return NextResponse.json(
      { configured: false, reason: "passwordless-not-configured" },
      { status: 200 },
    )
  }

  // Identities (emails from the plan, passwords by role) — WITHOUT any verified
  // flag; the orchestrator sets email_verified only after consuming each code.
  const identities = plan.identities.map((id) =>
    id.role === "primary"
      ? { email: id.email, password: primaryPassword, role: "primary" as const }
      : { email: id.email, password: secondaryPassword, role: "secondary" as const },
  )

  // One-time codes keyed by the (already normalized) plan email for each role.
  const primary = plan.identities.find((i) => i.role === "primary")!.email
  const secondary = plan.identities.find((i) => i.role === "secondary")?.email
  const codes: Record<string, string | undefined> = { [primary]: primaryOtp }
  if (secondary) codes[secondary] = secondaryOtp

  const outcome = await registerModel3WithProof(
    {
      connectionKey: "per-email",
      connectionName: plan.connectionName,
      connectionId: connectionIdForKey("per-email"),
      boundEmails,
      identities,
      codes,
    },
    {
      ...realManagementDeps,
      // Consume the code at the IdP; resolves on success, throws on a wrong /
      // expired / already-used code. We discard the returned identity — we only
      // care that consumption succeeded.
      verifyPasscode: async (email, otp) => {
        await verifyEmailPasscode(creds, email, otp)
      },
    },
  )

  if (!outcome.ok) {
    return NextResponse.json(
      {
        error: outcome.error,
        ...(outcome.failedEmails ? { failedEmails: outcome.failedEmails } : {}),
        ...(outcome.needResend ? { needResend: true } : {}),
      },
      { status: outcome.status },
    )
  }

  // Neutral success. Never echo the connection or user ids. Tell the client
  // whether a second email is still available to add via the completion journey.
  const res = NextResponse.json(
    {
      status: "created",
      credentialCount: outcome.credentials.length,
      completionAvailable: !plan.hasSecondary,
    },
    { status: 201 },
  )
  // Journey hygiene: drop the (now spent) binding cookie. This is NOT the
  // replay defence — the IdP already consumed each code — just cleanup so a
  // fresh sign-up rebinds cleanly.
  res.cookies.set(cookieName, "", { ...journeyCookieOptions(), maxAge: 0 })
  return res
}
