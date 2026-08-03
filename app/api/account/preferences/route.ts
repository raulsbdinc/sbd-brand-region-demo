import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import { sanitizePreferences } from "@/lib/metadata-schema"

// /api/account/preferences
//   GET   → the signed-in user's site preferences, read from `user_metadata`
//           and merged over defaults (so the UI always has a complete shape).
//   PATCH → write preferences back to `user_metadata`. The body is run through
//           the schema allow-list (lib/metadata-schema) so ONLY known
//           preference keys with valid values are ever stored — a client can
//           never stash arbitrary keys, secrets, or access-affecting fields
//           (those live in app_metadata and are not writable here).
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    return NextResponse.json({
      configured: true,
      preferences: sanitizePreferences(user.user_metadata),
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Allow-list + normalize. Anything not in the schema is dropped here.
  const preferences = sanitizePreferences(body)

  try {
    // Auth0 shallow-merges top-level user_metadata keys; we write the full,
    // validated preferences object so nested fields (communication_prefs)
    // replace cleanly rather than partially merging.
    const user = await updateUser(guard.user.sub, { user_metadata: preferences })
    return NextResponse.json({
      configured: true,
      preferences: sanitizePreferences(user.user_metadata),
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
