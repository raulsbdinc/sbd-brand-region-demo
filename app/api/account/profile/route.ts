import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import { validateProgressiveProfileField } from "@/lib/progressive-profile"

// /api/account/profile
//   GET   → the signed-in user's live profile (scoped to their own sub).
//   PATCH → update a SAFE allowlist of profile fields. Email changes go through
//           here too, but we always reset email_verified so Auth0 re-verifies.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    return NextResponse.json({ configured: true, user })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

// Only these top-level fields can be changed from the account center. Anything
// else in the body is ignored — never trust the client to scope writes.
const ALLOWED_FIELDS = ["name", "given_name", "family_name", "nickname"] as const

export async function PATCH(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  for (const field of ALLOWED_FIELDS) {
    if (typeof body[field] === "string" && (body[field] as string).trim()) {
      const value = (body[field] as string).trim()
      if (field === "given_name" || field === "family_name") {
        const error = validateProgressiveProfileField(field, value)
        if (error) return NextResponse.json({ error }, { status: 400 })
      }
      update[field] = value
    }
  }

  // Avatar (root `picture` attribute) — must be an http(s) URL. An empty string
  // clears it back to the connection/gravatar default.
  if (typeof body.picture === "string") {
    const picture = body.picture.trim()
    if (picture && !/^https?:\/\/\S+$/i.test(picture)) {
      return NextResponse.json(
        { error: "Enter a valid image URL (http or https)." },
        { status: 400 },
      )
    }
    update.picture = picture
  }

  // Phone number lives in user_metadata for database-connection users (the root
  // `phone_number` attribute is reserved for SMS connections). Auth0 merges
  // user_metadata shallowly, so this won't disturb the site-preferences keys.
  if (typeof body.phone_number === "string") {
    const raw = body.phone_number.trim()
    if (raw) {
      const error = validateProgressiveProfileField("phone_number", raw)
      if (error) return NextResponse.json({ error }, { status: 400 })
    }
    update.user_metadata = { phone_number: raw }
  }

  // Email change: validate shape, force re-verification.
  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      )
    }
    update.email = email
    update.email_verified = false
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields supplied." },
      { status: 400 },
    )
  }

  try {
    const user = await updateUser(guard.user.sub, update)
    return NextResponse.json({ configured: true, user })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
