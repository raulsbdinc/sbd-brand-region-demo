// MODEL 4 (PER-BRAND) REGISTRATION — entry route
// ==============================================
// UK-only. The customer registers on THIS storefront brand with an email + a
// brand-specific password. The browser submits only email + password; the model
// id, brand, and connection are all determined server-side.
//
//   • No existing account owns the email  → create this brand's account now.
//   • Exactly one existing account owns it → this is the cross-brand case: DON'T
//     create a duplicate. Return "proof-required" + a signed handoff cookie, and
//     make the customer prove ownership (existing password OR one-time email
//     code) at /api/registration/brand/proof before the second brand is linked.
//   • Ambiguous / lookup failed            → fail closed (never guess).
//
// The desired NEW brand password is NEVER stashed in the handoff (the token is
// signed, not encrypted); for the cross-brand case it is re-entered at the proof
// step. Here it is used only when creating a brand-new first-brand account.

import { NextResponse, type NextRequest } from "next/server"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import {
  connectionIdForKey,
  currentBrandCredentialExists,
  resolveExistingAccountByEmail,
} from "@/lib/credential-resolver"
import {
  planModel4Registration,
  type Model4RejectReason,
} from "@/lib/account-model"
import { executeBrandRegistration } from "@/lib/model-registration"
import { realManagementDeps } from "@/lib/model-registration-deps"
import { isManagementConfigured } from "@/lib/auth0-management"
import {
  journeyCookieName,
  journeyCookieOptions,
  mintJourneyToken,
} from "@/lib/journey-handoff"

export const runtime = "nodejs"

function planRejection(reason: Model4RejectReason): NextResponse {
  switch (reason) {
    case "not-configured":
      return NextResponse.json({ configured: false, reason: "not-configured" }, { status: 200 })
    case "market-unavailable":
      return NextResponse.json({ error: "That option isn't available here." }, { status: 400 })
    case "unsupported-brand":
      return NextResponse.json({ error: "That option isn't available here." }, { status: 400 })
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

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!email || !password) {
    return NextResponse.json({ error: "Enter an email and password." }, { status: 400 })
  }

  // Plan PURELY: validate email, gate to UK, resolve this brand's connection.
  const plan = planModel4Registration(
    { email },
    {
      market: SITE_MARKET,
      siteBrand: SITE_BRAND,
      connectionNames: resolveConnectionNames(),
    },
  )
  if (!plan.ok) return planRejection(plan.reason)

  if (!isManagementConfigured()) {
    return NextResponse.json({ configured: false, reason: "management-not-configured" }, { status: 200 })
  }

  // Current-brand duplicate takes PRECEDENCE over every fail-closed path below.
  // If THIS brand's sign-in already exists for this email, guide the customer to
  // Sign in (never a duplicate, never a generic failure) — even when the broader
  // owning-account lookup is momentarily ambiguous right after a cross-brand
  // link (the freshly created-then-linked secondary can transiently appear as a
  // second candidate for the same email). Symmetric across DeWalt/Stanley.
  if (await currentBrandCredentialExists(plan.email, plan.connectionKey)) {
    return NextResponse.json(
      {
        error: "An account already exists for this brand. Try signing in instead.",
        reason: "already-brand",
      },
      { status: 409 },
    )
  }

  // Detect an existing account server-side. Fail closed on anything but a clear
  // "none" (first registration) or a single owning account (cross-brand).
  const existing = await resolveExistingAccountByEmail(email)
  if (existing.kind === "configured-off") {
    return NextResponse.json({ configured: false, reason: "management-not-configured" }, { status: 200 })
  }
  if (existing.kind === "unavailable" || existing.kind === "ambiguous") {
    // Never reveal which; never guess an account to link under.
    return NextResponse.json(
      { error: "We couldn't complete that right now. Please try again." },
      { status: 409 },
    )
  }

  // --- First registration on this brand -----------------------------------
  if (existing.kind === "none") {
    const outcome = await executeBrandRegistration(
      {
        connectionKey: plan.connectionKey,
        connectionName: plan.connectionName,
        connectionId: connectionIdForKey(plan.connectionKey),
        email: plan.email,
        password,
        brand: plan.brand,
      },
      realManagementDeps,
    )
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }
    return NextResponse.json(
      { status: "created", credentialCount: outcome.credentials.length },
      { status: 201 },
    )
  }

  // --- Cross-brand: existing account found → require proof ----------------
  // Coherence pre-check: if the existing account is a per-email (Model 3)
  // account, linking a brand credential would MIX models. Fail closed here with
  // a neutral message rather than starting a proof the linker would later reject.
  const hasPerBrand = existing.account.bindings.some(
    (b) => b.connectionKey === "dewalt" || b.connectionKey === "stanley",
  )
  const hasPerEmail = existing.account.bindings.some((b) => b.connectionKey === "per-email")
  if (!hasPerBrand || hasPerEmail) {
    return NextResponse.json(
      { error: "We couldn't complete that right now. Please try again." },
      { status: 409 },
    )
  }

  // Already have THIS brand? Then there is nothing to link — neutral message.
  const alreadyThisBrand = existing.account.bindings.some(
    (b) => b.connectionKey === plan.connectionKey,
  )
  if (alreadyThisBrand) {
    // Machine-readable discriminator (additive) so the storefront Create Account
    // drawer can show existing-account / sign-in guidance for THIS brand rather
    // than a neutral "try again". Existing consumers that only read `error` are
    // unaffected.
    return NextResponse.json(
      {
        error: "An account already exists for this brand. Try signing in instead.",
        reason: "already-brand",
      },
      { status: 409 },
    )
  }

  // Offer email-code proof only when the mailbox is a known owned address.
  const canEmailCode = existing.account.verifiedEmails.some(
    (e) => e.toLowerCase() === email.toLowerCase(),
  )
  const proofOptions = canEmailCode ? ["password", "email-code"] : ["password"]

  const token = mintJourneyToken("model4-proof", {
    primaryUserId: existing.account.auth0UserId,
    email: plan.email,
    brand: plan.brand,
  })

  const res = NextResponse.json(
    { status: "proof-required", proofOptions },
    { status: 200 },
  )
  res.cookies.set(journeyCookieName("model4-proof"), token, journeyCookieOptions())
  return res
}
