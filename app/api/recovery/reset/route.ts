import { NextResponse } from "next/server"
import {
  resolvePasswordlessCreds,
  verifyEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"
import { recoveryBrandNotSetUp, resolveRecoveryTarget } from "@/lib/credential-resolver"
import { applyPasswordUpdate } from "@/lib/apply-password-update"
import { BRAND_NOT_SET_UP_CODE, brandNotSetUpMessage } from "@/lib/recovery-drawer"
import { runRecoveryReset } from "@/lib/recovery-reset-core"
import { SITE_BRAND_INFO, SITE_MARKET } from "@/lib/site"

/**
 * STEP 2 of the in-drawer "forgot password" flow. The decision flow lives in
 * lib/recovery-reset-core (preflight → single-use OTP proof → resolution → ONE
 * write); this route only supplies the provider operations.
 *
 * Resolution (lib/brand-signin-core resolveRecoveryFromUsers) uses the same
 * candidate facts as sign-in, including each record's verified login emails,
 * so a verified address of the canonical customer resets that customer's
 * THIS-brand password regardless of which address enrolled the brand. Distinct
 * customers claiming the email, no backed binding for this brand, or a failed
 * lookup all collapse to one neutral failure.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  const result = await runRecoveryReset(
    {
      body,
      hasCreds: Boolean(creds),
      market: SITE_MARKET,
      siteBrandName: SITE_BRAND_INFO.name,
      brandNotSetUpCode: BRAND_NOT_SET_UP_CODE,
      brandNotSetUpMessage: brandNotSetUpMessage(SITE_BRAND_INFO.name),
    },
    {
      async verifyCode(email, code) {
        try {
          await verifyEmailPasscode(creds!, email, code)
          return "ok"
        } catch (err) {
          if (err instanceof PasswordlessError && err.kind === "otp") return "bad-code"
          throw err
        }
      },
      resolveTarget: (email) => resolveRecoveryTarget(email),
      brandNotSetUp: (email) => recoveryBrandNotSetUp(email),
      applyUpdate: applyPasswordUpdate,
    },
  )
  return NextResponse.json(result.body, { status: result.status })
}
