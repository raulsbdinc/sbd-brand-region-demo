import { redirect } from "next/navigation"
import { buildDrawerRedirect } from "@/lib/auth-entry"

/**
 * Legacy `/sign-in/uk` is redirect-only. UK (DeWalt UK / Stanley UK) uses the
 * exact same standard storefront drawer as every other market — no model
 * chooser, no alternate UI. This route bounces to `/` with the `?auth=signin`
 * signal so the root `AuthEntrySignal` opens that one drawer in sign-in mode and
 * cleans the URL. The drawer posts to /api/signin/password, which resolves the
 * connection purely from the submitted email + this deployment's SITE_BRAND, so
 * the customer never sees or picks an identity model.
 */
export default function UkSignInRedirectPage() {
  redirect(buildDrawerRedirect({ mode: "sign-in" }))
}
