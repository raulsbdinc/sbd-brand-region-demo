import { NextResponse } from "next/server"
import {
  GENERIC_RECOVERY_MESSAGE,
  isRecoveryThrottled,
  normalizeRecoveryEmail,
  recoveryThrottleKey,
} from "@/lib/account-recovery"
import {
  resolvePasswordlessCreds,
  startEmailPasscode,
  PasswordlessError,
} from "@/lib/auth0-passwordless"
import { recoveryBrandNotSetUp } from "@/lib/credential-resolver"
import { BRAND_NOT_SET_UP_CODE, brandNotSetUpMessage } from "@/lib/recovery-drawer"
import { SITE_BRAND_INFO } from "@/lib/site"

/**
 * STEP 1 of the in-drawer "forgot password" flow: email a one-time verification
 * code to the address the customer typed.
 *
 * This deliberately mirrors public recovery's privacy contract — the response
 * NEVER varies with whether an SBD account exists. The passwordless `email`
 * connection will mail a code to any address, so we always answer with the same
 * neutral "if that address can be verified, a code is on its way" shape and
 * absorb every upstream error. The code only PROVES mailbox ownership; which
 * credential (if any) gets reset is decided later in /api/recovery/reset from
 * the email + this deployment's SITE_BRAND, exactly as sign-in resolves.
 */
const neutral = () =>
  NextResponse.json({ ok: true, message: GENERIC_RECOVERY_MESSAGE })

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    )
  }

  const email = normalizeRecoveryEmail(body.email)
  if (!email) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    )
  }

  // Same per-email/IP throttle as public recovery; a throttled request still
  // returns the identical neutral response so it is indistinguishable.
  if (isRecoveryThrottled(recoveryThrottleKey(email, request))) return neutral()

  // CIAM-17 (UK only): a sister-brand-only account has no password on THIS
  // brand to reset. Send no code and create nothing — guide the customer to
  // Create Account, which runs the existing second-brand ownership proof.
  try {
    if (await recoveryBrandNotSetUp(email)) {
      return NextResponse.json({
        ok: true,
        code: BRAND_NOT_SET_UP_CODE,
        message: brandNotSetUpMessage(SITE_BRAND_INFO.name),
      })
    }
  } catch {
    // Lookup failure → fall through to the ordinary neutral recovery.
  }

  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) return neutral()

  try {
    await startEmailPasscode(creds, email)
  } catch (err) {
    // Absorb send failures so account existence / delivery state never leak.
    if (!(err instanceof PasswordlessError)) {
      console.log("[v0] recovery/start unexpected error")
    }
  }

  return neutral()
}
