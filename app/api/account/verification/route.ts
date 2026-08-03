import { NextResponse } from "next/server"
import { maskedEmail } from "@/lib/account-recovery"
import {
  managementErrorResponse,
  requireAccountUser,
} from "@/lib/account-guard"
import { getUser, sendVerificationEmail } from "@/lib/auth0-management"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    return NextResponse.json({
      configured: true,
      verified: Boolean(user.email_verified),
      destination: user.email ? maskedEmail(user.email) : null,
      hasEmail: Boolean(user.email),
    })
  } catch (error) {
    return managementErrorResponse(error)
  }
}

export async function POST() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    if (!user.email || user.email_verified) {
      return NextResponse.json({
        configured: true,
        sent: false,
        verified: Boolean(user.email_verified),
        destination: user.email ? maskedEmail(user.email) : null,
      })
    }

    await sendVerificationEmail(user.user_id)
    return NextResponse.json({
      configured: true,
      sent: true,
      verified: false,
      destination: maskedEmail(user.email),
    })
  } catch (error) {
    return managementErrorResponse(error)
  }
}
