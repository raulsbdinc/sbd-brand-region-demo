// MODEL 3 (PER-EMAIL) REGISTRATION — server route
// ================================================
// UK-only. Creates the primary per-email identity and, when a second email +
// password are supplied at sign-up, creates and links that too — all on the
// per-email connection, under ONE primary Auth0 profile, with one coherent
// binding each. The browser submits ONLY emails + passwords; the model id is
// validated and the connection resolved entirely server-side. When the second
// email is skipped, the client is told a completion journey is available
// (POST /api/registration/per-email/complete) instead of generic provisioning.

import { NextResponse, type NextRequest } from "next/server"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import { connectionIdForKey } from "@/lib/credential-resolver"
import {
  planModel3Registration,
  type Model3RejectReason,
} from "@/lib/account-model"
import {
  executePerEmailRegistration,
  type IdentityToCreate,
} from "@/lib/model-registration"
import { realManagementDeps } from "@/lib/model-registration-deps"
import { isManagementConfigured } from "@/lib/auth0-management"

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

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }

  const primaryEmail = typeof body.primaryEmail === "string" ? body.primaryEmail.trim() : ""
  const primaryPassword = typeof body.primaryPassword === "string" ? body.primaryPassword : ""
  const secondaryEmailRaw =
    typeof body.secondaryEmail === "string" ? body.secondaryEmail.trim() : ""
  const secondaryPassword =
    typeof body.secondaryPassword === "string" ? body.secondaryPassword : ""

  if (!primaryEmail || !primaryPassword) {
    return NextResponse.json({ error: "Enter an email and password." }, { status: 400 })
  }

  // Plan the model PURELY: validates the emails, gates to UK, resolves the
  // per-email connection from env. Never trusts a connection name from the body.
  const plan = planModel3Registration(
    { primaryEmail, secondaryEmail: secondaryEmailRaw || undefined },
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

  // Attach passwords to the planned identities (emails + roles come from the
  // planner; passwords never leave the server boundary shape).
  const identities: IdentityToCreate[] = plan.identities.map((id) =>
    id.role === "primary"
      ? { email: id.email, password: primaryPassword, role: "primary" as const }
      : { email: id.email, password: secondaryPassword, role: "secondary" as const },
  )

  // A supplied second email needs its own password.
  if (plan.hasSecondary && !secondaryPassword) {
    return NextResponse.json(
      { error: "Enter a password for the second email." },
      { status: 400 },
    )
  }

  const outcome = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: plan.connectionName,
      connectionId: connectionIdForKey("per-email"),
      identities,
    },
    realManagementDeps,
  )

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  // Neutral success. Never echo the connection or user ids. Tell the client
  // whether a second email is still available to add via the completion journey.
  return NextResponse.json(
    {
      status: "created",
      credentialCount: outcome.credentials.length,
      completionAvailable: !plan.hasSecondary,
    },
    { status: 201 },
  )
}
