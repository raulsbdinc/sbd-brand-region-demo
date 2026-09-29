// MODEL 4 CROSS-BRAND PROOF + LINK
// ================================
// The customer proves they own the existing account (existing brand password OR
// one-time email code), then this brand's identity is created and linked under
// the existing primary with a coherent per-brand binding. Only reachable with a
// valid model4-proof handoff cookie. Fails CLOSED on: expired/forged handoff,
// the account no longer resolving to the same single owner, unproven ownership,
// a model conflict, a duplicate brand, or a partial provisioning failure. The
// NEW brand password is submitted HERE (never carried in the signed handoff).

import { NextResponse, type NextRequest } from "next/server"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames, type ConnectionKey } from "@/lib/credential-model"
import {
  connectionIdForKey,
  resolveExistingAccountByEmail,
  purgeTransientEmailStub,
} from "@/lib/credential-resolver"
import {
  brandProofMethodAllowed,
  planBrandSignupForExistingAccount,
  planModel4CrossBrandLink,
  type Model4LinkRejectReason,
} from "@/lib/account-model"
import { executeBrandLink } from "@/lib/model-registration"
import { realManagementDeps } from "@/lib/model-registration-deps"
import { isManagementConfigured } from "@/lib/auth0-management"
import {
  journeyCookieName,
  journeyCookieOptions,
  readJourneyToken,
} from "@/lib/journey-handoff"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { passwordRealmExchange } from "@/lib/auth0-password-grant"
import {
  resolvePasswordlessCreds,
  verifyEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"

export const runtime = "nodejs"

interface M4Handoff extends Record<string, unknown> {
  primaryUserId: string
  email: string
  brand: string
}

function planRejection(reason: Model4LinkRejectReason): NextResponse {
  switch (reason) {
    case "not-configured":
      return NextResponse.json({ configured: false, reason: "not-configured" }, { status: 200 })
    case "proof-required":
      return NextResponse.json({ error: "We couldn't verify that. Please try again." }, { status: 401 })
    default:
      // no-existing-account, model-conflict, duplicate-brand-credential,
      // market/brand/email — all collapse to one neutral message.
      return NextResponse.json(
        { error: "We couldn't complete that right now. Please try again." },
        { status: 409 },
      )
  }
}

function clearHandoff(res: NextResponse): void {
  res.cookies.set(journeyCookieName("model4-proof"), "", {
    ...journeyCookieOptions(),
    maxAge: 0,
  })
}

export async function POST(request: NextRequest) {
  const cookieName = journeyCookieName("model4-proof")
  const handoff = readJourneyToken<M4Handoff>(
    "model4-proof",
    request.cookies.get(cookieName)?.value,
  )
  if (!handoff.ok) {
    return NextResponse.json(
      { error: "That request has expired. Please start again." },
      { status: 401 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }

  const method = body.method === "email-code" ? "email-code" : "password"
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
  const existingPassword =
    typeof body.existingPassword === "string" ? body.existingPassword : ""
  const code = typeof body.code === "string" ? body.code.trim() : ""

  if (!newPassword) {
    return NextResponse.json(
      { error: "Choose a password for this brand." },
      { status: 400 },
    )
  }

  if (!isManagementConfigured()) {
    return NextResponse.json({ configured: false, reason: "management-not-configured" }, { status: 200 })
  }

  const email = handoff.data.email

  // Re-resolve the owning account FRESH (never trust the cookie's bindings). It
  // must still be exactly one account AND the same primary the handoff was
  // minted for — otherwise fail closed.
  const existing = await resolveExistingAccountByEmail(email)
  if (existing.kind !== "single" || existing.account.auth0UserId !== handoff.data.primaryUserId) {
    return NextResponse.json(
      { error: "We couldn't complete that right now. Please try again." },
      { status: 409 },
    )
  }

  // Re-derive which proofs this account allows from its FRESH record. An email
  // code is accepted only when the address is verified on the existing account.
  const brandKey = SITE_BRAND === "stanley" ? "stanley" : "dewalt"
  const offered = planBrandSignupForExistingAccount({
    connectionKey: brandKey,
    email,
    account: existing.account,
  })
  const offeredOptions = offered.kind === "proof-required" ? offered.proofOptions : []
  if (!brandProofMethodAllowed(offeredOptions, method)) {
    return NextResponse.json(
      { error: "Confirm your email address first, then try again.", reason: "email-unverified" },
      { status: 409 },
    )
  }

  // --- Prove ownership of the existing account ----------------------------
  let proofVerified = false
  if (method === "password") {
    if (!existingPassword) {
      return NextResponse.json({ error: "Enter your existing password." }, { status: 400 })
    }
    const region = regionFromCookieHeader(request.headers.get("cookie"))
    const { domain, clientId, clientSecret } = resolveRegionAuthConfig(region)
    if (!domain || !clientId || !clientSecret) {
      return NextResponse.json(
        { error: "We couldn't verify that right now. Please try again." },
        { status: 200 },
      )
    }
    const firstHop = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    // Try the existing account's brand connection(s) — the customer's existing
    // password lives on whichever brand they first registered. Any success
    // proves ownership; the password is only ever checked by Auth0.
    const existingBrandKeys = Array.from(
      new Set(
        existing.account.bindings
          .map((b) => b.connectionKey)
          .filter((k): k is ConnectionKey => k === "dewalt" || k === "stanley"),
      ),
    )
    for (const key of existingBrandKeys) {
      const token = await passwordRealmExchange({
        domain,
        clientId,
        clientSecret,
        firstHop,
        username: email,
        password: existingPassword,
        connectionKey: key,
      })
      if (token) {
        proofVerified = true
        break
      }
    }
  } else {
    if (!code) {
      return NextResponse.json({ error: "Enter the code we emailed you." }, { status: 400 })
    }
    const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
    if (!creds) {
      return NextResponse.json(
        { error: "We couldn't verify that right now. Please try again." },
        { status: 200 },
      )
    }
    try {
      await verifyEmailPasscode(creds, email, code)
      proofVerified = true
      // The emailed code was proof only — the new brand credential is a fresh DB
      // identity created below, so this transient passwordless stub is disposable
      // and nothing downstream references it. Purge it now so a successful link
      // (or any later plan/link failure) never leaves an orphan email|… user
      // behind. purgeTransientEmailStub only deletes all-passwordless standalone
      // records, so the existing primary (a real DB identity) is never touched.
      await purgeTransientEmailStub(email)
    } catch (err) {
      if (err instanceof PasswordlessError) {
        return NextResponse.json({ error: "That code isn't right. Please try again." }, { status: 401 })
      }
      throw err
    }
  }

  // --- Plan the link PURELY (fails closed if proof missing/model conflict) --
  const plan = planModel4CrossBrandLink({
    market: SITE_MARKET,
    siteBrand: SITE_BRAND,
    email,
    existingAccount: {
      auth0UserId: existing.account.auth0UserId,
      bindings: existing.account.bindings,
    },
    proofVerified,
    connectionNames: resolveConnectionNames(),
  })
  if (!plan.ok) return planRejection(plan.reason)

  // --- Create + link the NEW brand identity -------------------------------
  const outcome = await executeBrandLink(
    {
      primaryUserId: plan.primaryUserId,
      connectionKey: plan.connectionKey,
      connectionName: plan.connectionName,
      connectionId: connectionIdForKey(plan.connectionKey),
      email: plan.email,
      password: newPassword,
      brand: plan.brand,
    },
    realManagementDeps,
  )
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  const res = NextResponse.json(
    { status: "linked", credentialCount: outcome.credentials.length },
    { status: 201 },
  )
  clearHandoff(res)
  return res
}
