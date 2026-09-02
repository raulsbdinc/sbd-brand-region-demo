import { redirect } from "next/navigation"
import { buildDrawerRedirect } from "@/lib/auth-entry"

/**
 * Legacy `/signin` is no longer a standalone sign-in page. The storefront's ONLY
 * user-facing sign-in surface is the standard drawer on the root, so this route
 * is a compatibility redirect to `/` with the `?auth=signin` signal that the
 * root `AuthEntrySignal` consumer turns into "open the drawer in sign-in mode",
 * then cleans out of the URL. Server-side `redirect()` keeps it instant with no
 * flash of a parallel frontend.
 */
export default function SignInRedirectPage() {
  redirect(buildDrawerRedirect({ mode: "sign-in" }))
}
