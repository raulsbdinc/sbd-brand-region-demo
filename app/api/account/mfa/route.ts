import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import {
  getMfaEnrollments,
  deleteMfaEnrollment,
} from "@/lib/auth0-management"

// /api/account/mfa
//   GET    → list the signed-in user's confirmed/pending MFA enrollments.
//   DELETE → remove one enrollment by id (?id=...), after verifying the
//            enrollment belongs to the signed-in user.
//
// NOTE: ENROLLING a new factor cannot be done purely server-side — Guardian
// enrollment requires the end user to complete a challenge. The UI does that via
// a redirect to the hosted MFA/enrollment flow; see FEATURE_BACKLOG.md Part 3.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const enrollments = await getMfaEnrollments(guard.user.sub)
    return NextResponse.json({
      configured: true,
      enabled: enrollments.some((e) => e.status === "confirmed"),
      enrollments,
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const id = new URL(request.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json(
      { error: "Missing enrollment id." },
      { status: 400 },
    )
  }

  try {
    // Verify the enrollment is actually the signed-in user's before deleting —
    // the Guardian delete endpoint is keyed only by enrollment id.
    const owned = await getMfaEnrollments(guard.user.sub)
    if (!owned.some((e) => e.id === id)) {
      return NextResponse.json(
        { error: "Enrollment not found for this account." },
        { status: 404 },
      )
    }
    await deleteMfaEnrollment(id)
    return NextResponse.json({ configured: true, removed: id })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
