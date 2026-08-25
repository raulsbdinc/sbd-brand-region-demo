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
  // this storefront gets its reset on its own connection; a shared-default (and
  // unknown emails) stays on the shared connection exactly as today. The
  // response never varies, so account existence and which connection matched
  // remain indistinguishable.
  //
  // AMBIGUOUS is the one case we must NOT paper over with a shared fallback:
  // sending a shared reset for an email that also has a non-shared credential
  // would leak the shared credential's existence and could reset the wrong
  // realm. On ambiguity we send NOTHING but keep the identical neutral response.
  const resolution = await resolveSigninCredential(email).catch(
    () => ({ kind: "shared-default" }) as const,
  )
  if (resolution.kind === "ambiguous") return genericResponse(true)

  const connectionName: string =
    resolution.kind === "resolved" ? resolution.connectionName : PASSWORD_CONNECTION

  try {
    await requestPasswordResetEmail(email, connectionName)
  } catch {
    // Public recovery intentionally absorbs upstream errors so account existence,
    // provider, and delivery state remain indistinguishable to the requester.
  }

  return genericResponse(true)
}
