import { NextResponse } from "next/server"
import {
  GENERIC_RECOVERY_MESSAGE,
  isRecoveryThrottled,
  normalizeRecoveryEmail,
  normalizeRecoveryIntent,
  recoveryThrottleKey,
} from "@/lib/account-recovery"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"
import { isAuthConfigured } from "@/lib/auth0"
import { requestPasswordResetEmail } from "@/lib/auth0-management"

const genericResponse = (configured: boolean) =>
  NextResponse.json({ ok: true, configured, message: GENERIC_RECOVERY_MESSAGE })

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  }

  const email = normalizeRecoveryEmail(body.email)
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  }

  normalizeRecoveryIntent(body.intent)
  const configured = isAuthConfigured()
  const throttled = isRecoveryThrottled(recoveryThrottleKey(email, request))

  if (!configured || throttled) return genericResponse(configured)

  try {
    await requestPasswordResetEmail(email, PASSWORD_CONNECTION)
  } catch {
    // Public recovery intentionally absorbs upstream errors so account existence,
    // provider, and delivery state remain indistinguishable to the requester.
  }

  return genericResponse(true)
}
