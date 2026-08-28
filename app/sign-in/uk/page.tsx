import type { Metadata } from "next"
import Link from "next/link"
import { Info } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { BRANDS } from "@/lib/brands"
import { accountModelSelectionAvailable } from "@/lib/account-model"
import { effectiveMarket, previewOverrideAllowed } from "@/lib/preview-market"
import { safeReturnTo, isUkSignInOptionId } from "@/lib/uk-signin"
import { UkSignInChooser } from "@/components/uk-signin-chooser"

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Tell us how your account was set up and we'll take you to the right sign-in.",
}

// SITE_MARKET is fixed per deployment. In non-production a `?market=uk` override
// lets us demo the UK sign-in chooser on a non-UK preview; production always
// uses the deployment's real market. The start route re-gates server-side.
export const dynamic = "force-dynamic"

function otherBrandName(brand: typeof SITE_BRAND): string {
  return brand === "stanley" ? BRANDS.dewalt.name : BRANDS.stanley.name
}

export default async function UkSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rawMarket = sp.market
  const override = typeof rawMarket === "string" ? rawMarket : null
  const { market, overridden } = effectiveMarket({
    siteMarket: SITE_MARKET,
    override,
    allowOverride: previewOverrideAllowed(process.env.VERCEL_ENV),
  })

  // Strict gate: only UK (real or preview-overridden) shows the chooser.
  if (!accountModelSelectionAvailable(market)) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <Alert>
          <Info />
          <AlertTitle>Not available for this storefront</AlertTitle>
          <AlertDescription>
            This guided sign-in is only offered on our UK storefront. Please use
            the standard sign-in for this region.
          </AlertDescription>
        </Alert>
        <Button className="mt-6" render={<Link href="/auth/login" />}>
          Continue to sign in
        </Button>
      </main>
    )
  }

  const rawReturn = sp.returnTo
  const returnTo = safeReturnTo(typeof rawReturn === "string" ? rawReturn : null)
  const rawError = sp.error
  const initialError = typeof rawError === "string" ? rawError : null
  const rawOption = sp.option
  const initialOption =
    typeof rawOption === "string" && isUkSignInOptionId(rawOption)
      ? rawOption
      : null

  return (
    <UkSignInChooser
      brand={SITE_BRAND}
      brandName={BRANDS[SITE_BRAND].name}
      otherBrandName={otherBrandName(SITE_BRAND)}
      overridden={overridden}
      returnTo={returnTo}
      initialError={initialError}
      initialOption={initialOption}
    />
  )
}
