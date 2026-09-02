"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useApp } from "@/components/app-providers"

// UK is simply the isolated demo environment for use cases 3 and 4 on DeWalt UK
// and Stanley UK — it gets the NORMAL branded storefront sign-in, not an
// identity-model chooser. The old /sign-in/uk chooser ("how was your account
// set up?") was the regression this route removes.
//
// This route is kept only so existing links to it (the registration screen's
// "Already have an account? Sign in", and the post-registration start route's
// error fallback) land somewhere sensible: it opens the SAME branded sign-in
// drawer every other entry point uses, then returns to the storefront home. The
// drawer resolves the credential path from the submitted email + SITE_BRAND, so
// no model / connection / realm is ever exposed to the customer.
export default function UkSignInRedirect() {
  const router = useRouter()
  const { openSignIn } = useApp()

  useEffect(() => {
    openSignIn()
    router.replace("/")
  }, [openSignIn, router])

  return null
}
