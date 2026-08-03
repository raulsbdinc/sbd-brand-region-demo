import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { createPasswordChangeTicket } from "@/lib/auth0-management"

// POST /api/account/password-reset
// Creates a real Auth0 password-change ticket for the signed-in user and
// returns the one-time URL. (We return the ticket URL rather than auto-emailing
// so the demo can show the result; in production you'd typically email it or
// rely on the Authentication API's password-reset email instead.)
export const dynamic = "force-dynamic"

export async function POST() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const { ticket } = await createPasswordChangeTicket({
      user_id: guard.user.sub,
      ttl_sec: 60 * 30, // 30 minutes
    })
    return NextResponse.json({ configured: true, ticket })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
