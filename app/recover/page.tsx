import { redirect } from "next/navigation"
import { buildDrawerRedirect } from "@/lib/auth-entry"

/**
 * Legacy `/recover` is no longer a standalone recovery page. Every customer
 * auth/recovery interaction now starts and stays in the standard storefront
 * drawer, so this route is a compatibility redirect to `/` with the
 * `?auth=recover` signal that the root `AuthEntrySignal` consumer turns into
 * "open the drawer in recovery mode", then cleans out of the URL. Server-side
 * `redirect()` keeps it instant with no flash of a parallel recovery frontend.
 */
export default function RecoverRedirectPage() {
  redirect(buildDrawerRedirect({ mode: "recover" }))
}
