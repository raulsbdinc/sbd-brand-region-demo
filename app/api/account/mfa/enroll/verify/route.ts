import { NextResponse } from "next/server"
import { requireAccountUser, managementErrorResponse } from "@/lib/account-guard"
import { enrollTotpAuthenticator } from "@/lib/auth0-management"
import { verifyTotp } from "@/lib/mfa-totp"
import {
  decodeMfaEnroll,
  MFA_ENROLL_COOKIE_NAME,
} from "@/lib/mfa-enroll-handoff"

// POST /api/account/mfa/enroll/verify   body: { code }
//   Completes the inline enrolment started above. The order is the point:
//     1. read the pending secret from the httpOnly handoff cookie,
//     2. verify the 6-digit code against it OURSELVES (standard TOTP), and
//     3. ONLY if that passes, register the factor with Auth0.
//   Verifying before registering means a mis-scanned QR never becomes a broken
//   enrolment the person can't use and can't easily remove.
export const dynamic = "force-dynamic"

/** Clears the handoff cookie on a response. */
function clearHandoff(res: NextResponse): NextResponse {
  res.cookies.set(MFA_ENROLL_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return res
}

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const body = (await request.json().catch(() => ({}))) as { code?: unknown }
  const code = typeof body.code === "string" ? body.code.trim() : ""

  const cookieHeader = request.headers.get("cookie") ?? ""
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${MFA_ENROLL_COOKIE_NAME}=`))
    ?.slice(MFA_ENROLL_COOKIE_NAME.length + 1)
  const handoff = decodeMfaEnroll(raw ? decodeURIComponent(raw) : undefined)

  if (!handoff) {
    // Nothing pending (expired, cleared, or never started). Ask them to restart.
    return clearHandoff(
      NextResponse.json(
        {
          error:
            "Your setup session expired. Start again to get a fresh QR code.",
          code: "expired",
        },
        { status: 400 },
      ),
    )
  }

  // Verify the code against the secret WE issued, before touching Auth0.
  if (!verifyTotp(handoff.secret, code)) {
    // Keep the handoff cookie so the person can retry with the next code.
    return NextResponse.json(
      {
        error:
          "That code didn't match. Check your authenticator app and try the current 6-digit code.",
      },
      { status: 400 },
    )
  }

  try {
    const registered = await enrollTotpAuthenticator(
      guard.user.sub,
      handoff.secret,
      "Authenticator app",
    )
    return clearHandoff(
      NextResponse.json({ configured: true, enrolled: registered }),
    )
  } catch (err) {
    // Registration failed after a good code — clear the cookie so a retry
    // starts clean rather than reusing a secret Auth0 may have partly stored.
    const res = managementErrorResponse(err)
    return clearHandoff(res)
  }
}
