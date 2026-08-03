import { NextResponse } from "next/server"
import { managementErrorResponse, requireAccountUser } from "@/lib/account-guard"
import { updateUser } from "@/lib/auth0-management"
import { sanitizePendingRegistration } from "@/lib/registration"

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const registration = sanitizePendingRegistration(body)
  if (!registration) return NextResponse.json({ error: "Invalid registration receipt" }, { status: 400 })

  try {
    await updateUser(guard.user.sub, {
      user_metadata: {
        registration_receipt: {
          entry_point: registration.entryPoint,
          terms_version: registration.legalVersions.terms,
          privacy_version: registration.legalVersions.privacy,
          accepted_at: registration.acceptedAt,
          marketing_consent: registration.marketingConsent,
        },
      },
    })
    return NextResponse.json({ configured: true, saved: true })
  } catch (error) {
    return managementErrorResponse(error)
  }
}
