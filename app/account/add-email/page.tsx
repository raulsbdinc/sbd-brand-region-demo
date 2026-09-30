import type { Metadata } from "next"
import Link from "next/link"
import { Info, LogIn } from "lucide-react"
import { SITE_MARKET } from "@/lib/site"
import { perEmailAccountsEnabled } from "@/lib/uk-feature-flags"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { AddEmailJourney } from "@/components/add-email-journey"

export const metadata: Metadata = {
  title: "Add another sign-in email",
  description: "Add a second sign-in email to your existing account.",
}

// Authenticated Model 3 completion journey. A real session renders the journey;
// otherwise we prompt to sign in (the API endpoints also require a session, so
// this is a friendly gate rather than the only guard).
export const dynamic = "force-dynamic"

export default async function AddEmailPage() {
  let signedIn = false
  if (isAuthConfigured()) {
    try {
      const session = await auth0.getSession()
      signedIn = Boolean(session?.user)
    } catch {
      signedIn = false
    }
  }

  // UK with the per-email setup switched off: this journey (a separate
  // password for another email) is not offered. EU behaviour is unchanged.
  if (SITE_MARKET === "uk" && !perEmailAccountsEnabled(SITE_MARKET)) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <Alert>
          <Info />
          <AlertTitle>Not available on this storefront</AlertTitle>
          <AlertDescription>
            You can use the same verified email for DeWalt and Stanley, with a
            separate password for each brand. Manage your brand passwords from
            your profile.
          </AlertDescription>
        </Alert>
        <Button className="mt-6" render={<Link href="/profile" />}>
          Go to your profile
        </Button>
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <Alert>
          <LogIn />
          <AlertTitle>Please sign in first</AlertTitle>
          <AlertDescription>
            You need to be signed in to add another email to your account.
          </AlertDescription>
        </Alert>
        <Button className="mt-6" render={<Link href="/auth/login" />}>
          Sign in
        </Button>
      </main>
    )
  }

  return <AddEmailJourney />
}
