import { redirect } from "next/navigation"
import { buildDrawerRedirect } from "@/lib/auth-entry"

/**
 * Legacy `/register/uk` is redirect-only — there is no standalone registration
 * UI and no model chooser. Account creation for every market (including DeWalt
 * UK / Stanley UK) happens in the ONE standard storefront drawer. This route
 * bounces to `/` with the `?auth=create` signal so the root `AuthEntrySignal`
 * opens that drawer straight on the Create Account step and cleans the URL. The
 * drawer's create flow handles the UK cross-brand (Model 4) linking inline with
 * a mandatory OTP; the customer never picks an identity model.
 */
export default function UkRegisterRedirectPage() {
  redirect(buildDrawerRedirect({ mode: "create-account" }))
}
