import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, getUserOrganizations } from "@/lib/auth0-management"

// GET /api/account/export
// GDPR / CCPA data-portability: assemble the signed-in user's full profile plus
// org memberships into a downloadable JSON document. We return it inline with a
// Content-Disposition so the browser saves a file. For very large datasets you
// would instead kick off the Management API's bulk user-export job and email a
// link; for a single self-service user, a synchronous assembly is simplest.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const [user, organizations] = await Promise.all([
      getUser(guard.user.sub),
      getUserOrganizations(guard.user.sub).catch(() => []),
    ])

    const document = {
      exportedAt: new Date().toISOString(),
      subject: guard.user.sub,
      source: "Auth0 Management API (/api/v2)",
      profile: user,
      organizations,
    }

    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="sbd-account-export-${Date.now()}.json"`,
      },
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
