import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getLoginMethods } from "@/lib/auth0-management"

// /api/account/login-methods
//   GET → the consolidated "ways you sign in" list (linked identities +
//         passkeys) for the signed-in user, plus counts the UI uses to enforce
//         the lockout rule (you can always keep at least one way in).
//
// Removal is delegated to the existing /api/account/identities (unlink) and
// /api/account/passkeys (delete) routes, which BOTH enforce the same lockout
// guard server-side so the rule can't be bypassed from the client.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const result = await getLoginMethods(guard.user.sub)
    return NextResponse.json({ configured: true, ...result })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
