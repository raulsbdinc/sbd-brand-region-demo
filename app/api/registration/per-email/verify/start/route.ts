// MODEL 3 (PER-EMAIL) REGISTRATION — VERIFY STEP 1: email a one-time code
// =======================================================================
// UK-only, SIGNED-OUT. The approved Model-3 sign-up creates NOTHING until the
// person proves they own every email they're registering. This route emails a
// one-time code to ONE candidate email and (re)writes a signed, httpOnly,
// short-lived handoff cookie (purpose "model3-register") that BINDS the
// candidate email set to this journey — it carries only the emails, never a
// password, code, token, or any "verified" flag. Ownership itself is proven
// later by CONSUMING each code at the IdP during the final create request; this
// cookie only fixes WHICH emails that create is allowed to provision. It
// dry-runs the pure planner first so we never email a code for a request that
// would be rejected anyway, and re-gates on the real SITE_MARKET so a non-UK
// storefront honestly refuses. No Auth0 user is touched here.

import { NextResponse, type NextRequest } from "next/server"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import {
  planModel3Registration,
  type Model3RegisterBinding,
} from "@/lib/account-model"
import { startEmailPasscode, resolvePasswordlessCreds } from "@/lib/auth0-passwordless"
import {
  mintJourneyToken,
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

  const primaryEmail = typeof body.primaryEmail === "string" ? body.primaryEmail.trim() : ""
  const secondaryEmailRaw =
    typeof body.secondaryEmail === "string" ? body.secondaryEmail.trim() : ""
  // The specific address we're asked to send a code to this call.
  const target = typeof body.email === "string" ? body.email.trim() : ""
  if (!primaryEmail || !target) {
    return NextResponse.json({ error: "Enter an email address." }, { status: 400 })
  }

  // DRY RUN the pure plan: validates the emails, gates to UK, resolves the
  // per-email connection from env. Never trusts a connection from the body.
  const plan = planModel3Registration(
    { primaryEmail, secondaryEmail: secondaryEmailRaw || undefined },
    { market: SITE_MARKET, siteBrand: SITE_BRAND, connectionNames: resolveConnectionNames() },
  )
  if (!plan.ok) {
    if (plan.reason === "not-configured") {
      return NextResponse.json({ configured: false, reason: "not-configured" }, { status: 200 })
    }
    const map: Record<string, string> = {
      "market-unavailable": "That option isn't available here.",
      "invalid-primary-email": "Enter a valid email address.",
      "invalid-secondary-email": "Enter a valid second email address.",
      "duplicate-email": "Use two different email addresses.",
    }
    return NextResponse.json(
      { error: map[plan.reason] ?? "Enter a valid email address." },
      { status: 400 },
    )
  }

  // The target must be one of the planned identities (normalized). Otherwise the
  // browser is asking us to prove an address that isn't part of this sign-up.
  const planEmails = plan.identities.map((i) => i.email) // already normalized
  const primary = plan.identities.find((i) => i.role === "primary")!.email
  const secondary = plan.identities.find((i) => i.role === "secondary")?.email
  if (!planEmails.includes(norm(target))) {
    return NextResponse.json({ error: "Please start again." }, { status: 400 })
  }

  // Passwordless must be configured to send a code; otherwise this storefront
  // runs the Demo behaviour the client already knows how to show.
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    return NextResponse.json(
      { configured: false, reason: "passwordless-not-configured" },
      { status: 200 },
    )
  }
  try {
    await startEmailPasscode(creds, norm(target))
  } catch {
    return NextResponse.json(
      { error: "We couldn't send a code right now. Please try again." },
      { status: 502 },
    )
  }

  // (Re)bind the exact email set to this journey. There is no "verified" state
  // to preserve — proof happens at final create by consuming each code — so
  // sending a code for either address simply re-affirms the same binding, and
  // changing an address here naturally rebinds to the new set on the next send.
  const binding: Model3RegisterBinding = {
    primaryEmail: primary,
    ...(secondary ? { secondaryEmail: secondary } : {}),
  }

  const res = NextResponse.json({ status: "code-sent" }, { status: 200 })
  res.cookies.set(
    journeyCookieName("model3-register"),
    mintJourneyToken("model3-register", binding),
    journeyCookieOptions(),
  )
  return res
}
