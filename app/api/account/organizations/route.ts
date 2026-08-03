import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUserOrganizations } from "@/lib/auth0-management"

// GET /api/account/organizations
// The Auth0 Organizations the signed-in user belongs to (B2B multi-tenancy).
// Read-only here: joining/leaving an org is an admin- or invitation-gated
// operation, documented in FEATURE_BACKLOG.md Part 3.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const organizations = await getUserOrganizations(guard.user.sub)
    return NextResponse.json({ configured: true, organizations })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
