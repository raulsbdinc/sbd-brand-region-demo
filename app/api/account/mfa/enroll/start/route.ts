import { NextResponse } from "next/server"
import { requireAccountUser, managementErrorResponse } from "@/lib/account-guard"
import { getUser } from "@/lib/auth0-management"
import { createTotpEnrolment } from "@/lib/mfa-totp"
import {
  encodeMfaEnroll,
  MFA_ENROLL_COOKIE_NAME,
  MFA_ENROLL_TTL_SECONDS,
} from "@/lib/mfa-enroll-handoff"

// POST /api/account/mfa/enroll/start
//   Begins an inline authenticator enrolment. Generates a fresh TOTP secret,
//   labelled for this brand + market, and returns the otpauth:// URI (for the
//   QR) plus the base32 secret (for manual entry). The RAW secret is NOT
//   trusted back from the client — it is stashed in a short-lived, httpOnly,
//   HMAC-signed cookie so the verify step checks the typed code against the
//   exact secret we issued here. Nothing is registered with Auth0 yet.
export const dynamic = "force-dynamic"

export async function POST() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    // Prefer the directory email as the account label; fall back to the claim.
    let account = (guard.user.claims.email as string | undefined) ?? ""
    if (!account) {
      const user = await getUser(guard.user.sub).catch(() => null)
      account = user?.email ?? "account"
    }

    const enrolment = createTotpEnrolment(account)

    const res = NextResponse.json({
      configured: true,
      secret: enrolment.secret,
      uri: enrolment.uri,
      issuer: enrolment.issuer,
      account: enrolment.account,
    })
    res.cookies.set(MFA_ENROLL_COOKIE_NAME, encodeMfaEnroll({
      secret: enrolment.rawSecret,
      account: enrolment.account,
      iat: Date.now(),
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MFA_ENROLL_TTL_SECONDS,
    })
    return res
  } catch (err) {
    return managementErrorResponse(err)
  }
}
