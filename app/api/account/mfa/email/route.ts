import { NextResponse } from "next/server"
import { requireAccountUser, managementErrorResponse } from "@/lib/account-guard"
import {
  getUser,
  getAuthenticationMethods,
  enrollEmailAuthenticator,
  deleteAuthenticationMethod,
} from "@/lib/auth0-management"

// /api/account/mfa/email
//   POST   → add the "email security code" method to the signed-in account,
//            using the account's OWN primary email. Because that address is
//            already verified, Auth0 returns confirmed:true immediately, so
//            there is no second verification step to build.
//   DELETE → remove it again. The method id is resolved server-side from the
//            signed-in user's own methods — a route never trusts a client id.
//
// Same session guard as every other account route (requireAccountUser), the
// Management token comes from lib/auth0-management, and any failure returns a
// friendly on-screen message while the technical reason is logged server-side
// by managementErrorResponse.
export const dynamic = "force-dynamic"

export async function POST() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    const email = user.email
    if (!email) {
      return NextResponse.json(
        { error: "There's no email address on your account to use for this." },
        { status: 400 },
      )
    }
    const method = await enrollEmailAuthenticator(guard.user.sub, email, "Email")
    return NextResponse.json({
      configured: true,
      id: method.id,
      // Verified address → Auth0 confirms it on the spot.
      confirmed: method.confirmed ?? true,
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const methods = await getAuthenticationMethods(guard.user.sub).catch(() => [])
    const email = methods.find((m) => m.type === "email")
    if (!email) {
      // Nothing to remove — treat as success so the UI just settles to "off".
      return NextResponse.json({ configured: true, removed: null })
    }
    await deleteAuthenticationMethod(guard.user.sub, email.id)
    return NextResponse.json({ configured: true, removed: email.id })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
