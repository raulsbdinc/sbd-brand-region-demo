import type { Metadata } from "next"
import Link from "next/link"
import { Info } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { BRANDS } from "@/lib/brands"
import { accountModelSelectionAvailable } from "@/lib/account-model"
import { effectiveMarket, previewOverrideAllowed } from "@/lib/preview-market"
import { UkRegistration } from "@/components/uk-registration"

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Choose how you'd like to sign in and create your account with a guided journey.",
}

// SITE_MARKET is fixed per deployment. In non-production a `?market=uk` override
// lets us demo the UK journeys on a non-UK preview; production always uses the
// deployment's real market. Either way the API re-gates server-side.
export const dynamic = "force-dynamic"

// The two brands a UK per-brand account can span. SITE_BRAND is the deployment
// brand; the "other" brand is the one a customer might already shop.
function otherBrandName(brand: typeof SITE_BRAND): string {
  return brand === "stanley" ? BRANDS.dewalt.name : BRANDS.stanley.name
}

export default async function UkRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = sp.market
  const override = typeof raw === "string" ? raw : null
  const { market, overridden } = effectiveMarket({
    siteMarket: SITE_MARKET,
    override,
    allowOverride: previewOverrideAllowed(process.env.VERCEL_ENV),
  })

  // Strict gate: only UK (real or preview-overridden) shows these journeys.
  if (!accountModelSelectionAvailable(market)) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <Alert>
          <Info />
          <AlertTitle>Not available for this storefront</AlertTitle>
          <AlertDescription>
            The account-model registration journeys are only offered on our UK
            storefront. Please use the standard sign-up for this region.
          </AlertDescription>
        </Alert>
        <Button className="mt-6" render={<Link href="/register" />}>
          Back to registration
        </Button>
      </main>
    )
  }

  return (
    <UkRegistration
      brandName={BRANDS[SITE_BRAND].name}
      otherBrandName={otherBrandName(SITE_BRAND)}
      overridden={overridden}
    />
  )
}
