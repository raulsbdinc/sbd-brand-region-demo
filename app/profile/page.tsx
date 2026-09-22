import { auth0, isAuthConfigured } from "@/lib/auth0"
import { getUser } from "@/lib/auth0-management"
import { extractOtherSites } from "@/lib/claims"
import { AccountClient } from "@/components/account-client"
import { CustomerProfile } from "@/components/customer-profile"
import { PendingEmailVerification } from "@/components/pending-email-verification"
import { ProfileResolver } from "@/components/profile-resolver"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { profilePasswordModelVisibility } from "@/lib/brand-password-actions"
import { effectiveMarket, previewOverrideAllowed } from "@/lib/preview-market"

// /profile is the CUSTOMER-facing account page — the projector-friendly view.
//
// It uses exactly the same session-resolution pattern as /account (see
// app/account/page.tsx): a real Auth0 session renders the customer profile;
// configured-but-no-server-session hands off to <ProfileResolver /> (which
// re-checks via /api/me before deciding); and with no integration at all we
// fall back to the mock view. Same guarantees as /account — different body.
//
// The engineer-facing view (token inspection, directory internals, Live tags)
// stays unchanged at /account.
export const dynamic = "force-dynamic"

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session: { user: Record<string, unknown> } | null = null
  if (isAuthConfigured()) {
    try {
      session = await auth0.getSession()
    } catch {
      session = null
    }
  }

  if (session?.user) {
    // Read the cross-brand claim here (same as the old welcome page did) and
    // hand it to the customer profile, which renders the recognition panel at
    // the top. Empty on a first-ever site — the panel renders nothing then.
    const otherSites = extractOtherSites(session.user)

    // The session claim is whatever was true at sign-in. The directory is the
    // record that flips when the verification link is used, so a pending
    // account stays limited until that record says the address is confirmed.
    const sub = typeof session.user.sub === "string" ? session.user.sub : ""
    let emailVerified = session.user.email_verified === true
    if (sub) {
      try {
        const directory = await getUser(sub)
        emailVerified = directory.email_verified === true
      } catch {
        // A lookup failure must not lock out someone the session already
        // reports as verified.
      }
    }
    if (!emailVerified) {
      const email = typeof session.user.email === "string" ? session.user.email : null
      return <PendingEmailVerification email={email} />
    }

    // Discoverable password management differs by UK storefront (GLSCM-4834):
    // DeWalt UK runs Model 3 (a separate password per EMAIL, shown beside each
    // email) and Stanley UK runs Model 4 (a separate password per BRAND, shown
    // in a dedicated brand-password section). Each storefront exposes EXACTLY
    // ONE model; EU (fr/de) exposes neither and keeps the single Account
    // password. Resolve both gates from the effective market + deployment brand,
    // honoring the non-prod `?market=` preview override so an fr/de preview can
    // walk its brand's UK journey.
    const sp = await searchParams
    const rawMarket = sp?.market
    const overrideMarket = Array.isArray(rawMarket) ? rawMarket[0] : rawMarket
    const { market } = effectiveMarket({
      siteMarket: SITE_MARKET,
      override: overrideMarket ?? null,
      allowOverride: previewOverrideAllowed(process.env.VERCEL_ENV),
    })
    const { perEmail, perBrand } = profilePasswordModelVisibility({
      market,
      brand: SITE_BRAND,
    })

    return (
      <CustomerProfile
        user={session.user}
        sites={otherSites}
        perEmailModelAvailable={perEmail}
        perBrandModelAvailable={perBrand}
        deploymentBrand={SITE_BRAND}
      />
    )
  }

  if (isAuthConfigured()) {
    return <ProfileResolver />
  }

  return <AccountClient />
}
