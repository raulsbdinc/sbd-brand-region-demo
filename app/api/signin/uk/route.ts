// UK SIGN-IN START ROUTE
// ======================
// Server endpoint that turns a user-facing UK sign-in choice into a redirect to
// /auth/login pinned to the CORRECT Auth0 connection. The chooser client only
// ever knows the option ids (shared / per-email / brand / google) — this route
// resolves the real connection NAMES from server env and never returns them to
// the browser. It re-gates on the deployment's market (honouring the same
// non-production ?market=uk preview override the registration journeys use), so
// a non-UK storefront can't be coaxed into these routes in production.

import { NextResponse, type NextRequest } from "next/server"

import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import { accountModelSelectionAvailable } from "@/lib/account-model"
import { effectiveMarket, previewOverrideAllowed } from "@/lib/preview-market"
import { buildUkSignInTarget, isUkSignInOptionId } from "@/lib/uk-signin"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const origin = request.nextUrl.origin
  const marketOverride = sp.get("market")

  const { market } = effectiveMarket({
    siteMarket: SITE_MARKET,
    override: marketOverride,
    allowOverride: previewOverrideAllowed(process.env.VERCEL_ENV),
  })

  // Not a UK storefront (and not a permitted preview override): this routing
  // simply doesn't exist here. Send them home rather than to a wrong login.
  if (!accountModelSelectionAvailable(market)) {
    return NextResponse.redirect(new URL("/", origin))
  }

  const option = sp.get("option")
  if (!isUkSignInOptionId(option)) {
    return NextResponse.redirect(new URL("/sign-in/uk", origin))
  }

  const target = buildUkSignInTarget({
    optionId: option,
    email: sp.get("email"),
    returnTo: sp.get("returnTo"),
    brand: SITE_BRAND,
    // Server-only connection names; never exposed to the client.
    names: resolveConnectionNames(),
  })

  // On any resolution failure, bounce back to the chooser with a
  // non-revealing reason so it can show friendly copy and let them retry.
  if (!target.ok) {
    const back = new URL("/sign-in/uk", origin)
    back.searchParams.set("option", option)
    back.searchParams.set("error", target.reason)
    if (marketOverride) back.searchParams.set("market", marketOverride)
    return NextResponse.redirect(back)
  }

  return NextResponse.redirect(new URL(target.url, origin))
}
