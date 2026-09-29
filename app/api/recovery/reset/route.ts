import { NextResponse } from "next/server"
import { normalizeRecoveryEmail } from "@/lib/account-recovery"
import {
  resolvePasswordlessCreds,
  verifyEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"
import { recoveryBrandNotSetUp, resolveRecoveryTarget } from "@/lib/credential-resolver"
import { applyPasswordUpdate } from "@/lib/apply-password-update"
import { BRANDS } from "@/lib/brands"
import { BRAND_NOT_SET_UP_CODE, brandNotSetUpMessage } from "@/lib/recovery-drawer"
import { SITE_BRAND_INFO, SITE_MARKET } from "@/lib/site"
import {
  mapPasswordUpdateError,
  planPasswordUpdate,
  validateNewPassword,
} from "@/lib/password-change"

/**
 * STEP 2 of the in-drawer "forgot password" flow: consume the emailed code to
 * PROVE mailbox ownership, then reset EXACTLY the one credential that address +
 * this deployment's SITE_BRAND resolves to — the same resolution sign-in uses.
 *
 *   • Model 3 (per-email): the entered address → its own per-email identity, so
 *     resetting A never touches B (and vice-versa).
 *   • Model 4 (per-brand): SITE_BRAND → this brand's identity only, never the
 *     other brand's password.
 *   • Models 1/2 (shared): the account's single shared identity.
 *
 * Ordering matters: the OTP is verified (single-use at the IdP) BEFORE any
 * account resolution or write, so a wrong/expired code can never trigger a
 * lookup or reset. The exact-identity write + rollback are delegated to the
 * shared executor (lib/apply-password-update), identical to the in-site change.
 *
 * Privacy: a wrong code and a weak new password fail with specific, safe
 * messages (they describe the requester's own input). Everything else — no
 * account for a proven email, an ambiguous match, an upstream write error —
 * collapses to ONE neutral failure that never reveals whether an account exists
 * or which credential matched.
 */
const NEUTRAL_FAILURE =
  "We couldn't reset your password. Try again, or go back to sign in."

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Enter the details to continue." }, { status: 400 })
  }

  const email = normalizeRecoveryEmail(body.email)
  const code = typeof body.code === "string" ? body.code.trim() : ""
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""

  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  }
  if (!code) {
    return NextResponse.json({ error: "Enter the verification code we emailed you." }, { status: 400 })
  }
  // Validate the NEW password locally first — it describes the requester's own
  // input, so a specific hint here leaks nothing about the account.
  const policy = validateNewPassword(newPassword, SITE_MARKET, [email])
  if (!policy.ok) {
    return NextResponse.json(
      { code: "weak-password", error: "Choose a stronger password.", failures: policy.failures },
      { status: 400 },
    )
  }

  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    return NextResponse.json({ error: NEUTRAL_FAILURE }, { status: 400 })
  }

  // 1) PROVE ownership by consuming the emailed code (single-use at the IdP).
  //    A wrong/expired code is the expected failure and is safe to name.
  try {
    await verifyEmailPasscode(creds, email, code)
  } catch (err) {
    if (err instanceof PasswordlessError && err.kind === "otp") {
      return NextResponse.json(
        {
          code: "bad-code",
          error: "That code isn't right or has expired. Request a new one.",
        },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: NEUTRAL_FAILURE }, { status: 400 })
  }

  // 2) Resolve the EXACT identity this email + brand authenticates with. Any
  //    fail-closed outcome collapses to the single neutral failure.
  let target
  try {
    target = await resolveRecoveryTarget(email)
  } catch {
    return NextResponse.json({ error: NEUTRAL_FAILURE }, { status: 400 })
  }
  if (!target) {
    // CIAM-17: ownership is proven, so it is safe to say this brand's sign-in
    // isn't set up (e.g. a code requested before the start-step gate shipped).
    // Never create a credential here — Create Account owns that.
    const notSetUp = await recoveryBrandNotSetUp(email).catch(() => false)
    if (notSetUp) {
      return NextResponse.json(
        {
          code: BRAND_NOT_SET_UP_CODE,
          error: brandNotSetUpMessage(SITE_BRAND_INFO.name),
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: NEUTRAL_FAILURE }, { status: 400 })
  }

  // 3) Rewrite ONLY that identity's password via the shared executor.
  try {
    const plan = planPasswordUpdate({
      auth0UserId: target.auth0UserId,
      managementUserId: target.managementUserId,
      isLinkedSecondary: target.isLinkedSecondary,
      connectionName: target.connectionName,
      connectionId: target.connectionId,
    })
    await applyPasswordUpdate(plan, newPassword)
  } catch (err) {
    const status =
      typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : undefined
    const code2 = (err as { code?: string })?.code
    const message = err instanceof Error ? err.message : undefined
    return NextResponse.json(
      { error: mapPasswordUpdateError({ status, code: code2, message }) },
      { status: 400 },
    )
  }

  // Post-proof, the customer has demonstrated ownership of this exact mailbox,
  // so it is appropriate to name precisely which credential changed — but in
  // plain customer language, never internal jargon:
  //   • per-email (Model 3) -> the exact proven email address.
  //   • per-brand (Model 4) -> the current brand's natural name.
  //   • shared   (Model 1/2) -> a generic "your password".
  const scope: "per-email" | "brand" | "shared" =
    target.connectionKey === "dewalt" || target.connectionKey === "stanley"
      ? "brand"
      : target.connectionKey === "per-email"
        ? "per-email"
        : "shared"
  const brandName =
    scope === "brand" && target.brand ? BRANDS[target.brand].name : undefined

  return NextResponse.json({
    ok: true,
    message: "Your password has been updated. Sign in with your new password.",
    credential: { email: target.email, scope, brandName },
  })
}
