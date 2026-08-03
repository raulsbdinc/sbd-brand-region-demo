import { NextResponse } from "next/server"
import {
  managementErrorResponse,
  requireAccountUser,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import {
  progressiveProfileState,
  sanitizeProgressiveProfile,
} from "@/lib/progressive-profile"

export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    return NextResponse.json({
      configured: true,
      profile: progressiveProfileState(user),
    })
  } catch (error) {
    return managementErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const currentUser = await getUser(guard.user.sub)
    const current = progressiveProfileState(currentUser)
    const currentMetadata =
      typeof currentUser.user_metadata === "object" &&
      currentUser.user_metadata !== null
        ? (currentUser.user_metadata as Record<string, unknown>)
        : {}
    const now = new Date().toISOString()

    if (body.action === "dismiss") {
      const user = await updateUser(guard.user.sub, {
        user_metadata: {
          ...currentMetadata,
          progressive_profile_dismissed_at: now,
        },
      })
      return NextResponse.json({
        configured: true,
        profile: progressiveProfileState(user),
      })
    }

    const { values, errors } = sanitizeProgressiveProfile(body, current.missing)
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { error: "Check the highlighted fields.", errors },
        { status: 400 },
      )
    }

    const nextValues = { ...current.values, ...values }
    const willBeComplete = Object.values(nextValues).every(Boolean)
    const user = await updateUser(guard.user.sub, {
      ...(values.given_name ? { given_name: values.given_name } : {}),
      ...(values.family_name ? { family_name: values.family_name } : {}),
      user_metadata: {
        ...currentMetadata,
        ...(values.phone_number ? { phone_number: values.phone_number } : {}),
        ...(willBeComplete
          ? {
              progressive_profile_completed_at: now,
              progressive_profile_dismissed_at: null,
            }
          : {}),
      },
    })

    return NextResponse.json({
      configured: true,
      profile: progressiveProfileState(user),
    })
  } catch (error) {
    return managementErrorResponse(error)
  }
}
