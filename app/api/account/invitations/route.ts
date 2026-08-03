import { NextResponse } from "next/server"
import { managementErrorResponse, requireAccountUser } from "@/lib/account-guard"
import { createOrganizationInvitation, getUserOrganizations } from "@/lib/auth0-management"

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : ""
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const inviterName = typeof body.inviterName === "string" ? body.inviterName.trim().slice(0, 80) : ""
  if (!organizationId || !/^\S+@\S+\.\S+$/.test(email) || inviterName.length < 2) {
    return NextResponse.json({ error: "Check the organization, email, and inviter name." }, { status: 400 })
  }

  try {
    const memberships = await getUserOrganizations(guard.user.sub)
    if (!memberships.some((organization) => organization.id === organizationId)) {
      return NextResponse.json({ error: "You can only invite users to a team you belong to." }, { status: 403 })
    }
    const invitation = await createOrganizationInvitation(organizationId, { email, inviterName })
    return NextResponse.json({ configured: true, invitation: { id: invitation.id, email: invitation.invitee.email, expiresAt: invitation.expires_at ?? null } })
  } catch (error) {
    return managementErrorResponse(error)
  }
}
