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
import { resolveSigninCredential } from "@/lib/credential-resolver"

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

  // Resolve the connection the same way sign-in does: a case-3/4 identity on
  // this storefront gets its reset on its own connection; everything else stays
  // on the shared connection exactly as today. Any resolution failure silently
  // falls back to the shared connection — the response never varies, so account
  // existence and which connection matched remain indistinguishable.
  let connectionName: string = PASSWORD_CONNECTION
  try {
    const resolved = await resolveSigninCredential(email)
    if (resolved) connectionName = resolved.connectionName
  } catch {
    // keep the shared connection
  }

  try {
    await requestPasswordResetEmail(email, connectionName)
  } catch {
    // Public recovery intentionally absorbs upstream errors so account existence,
    // provider, and delivery state remain indistinguishable to the requester.
  }

  return genericResponse(true)
}
