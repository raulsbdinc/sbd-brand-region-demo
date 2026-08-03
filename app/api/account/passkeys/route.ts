import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
  ensureNotLastLoginMethod,
} from "@/lib/account-guard"
import {
  getAuthenticationMethods,
  deleteAuthenticationMethod,
} from "@/lib/auth0-management"

// /api/account/passkeys
//   GET    → the signed-in user's passkeys (authentication methods of type
//            "passkey"/"webauthn-*"), scoped to their own sub.
//   DELETE → remove one passkey by id (?id=...).
//
// NOTE: REGISTERING a new passkey requires a WebAuthn ceremony in the browser
// against Auth0's hosted flow — it can't be created server-side via the
// Management API. The UI handles that with a redirect; see FEATURE_BACKLOG.md Part 3.
export const dynamic = "force-dynamic"

const PASSKEY_TYPES = ["passkey", "webauthn-roaming", "webauthn-platform"]

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const methods = await getAuthenticationMethods(guard.user.sub)
    const passkeys = methods.filter((m) =>
      PASSKEY_TYPES.some((t) => m.type?.startsWith(t)),
    )
    return NextResponse.json({ configured: true, passkeys })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const id = new URL(request.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Missing passkey id." }, { status: 400 })
  }

  try {
    // Never let a user remove their last way to sign in.
    const lockout = await ensureNotLastLoginMethod(guard.user.sub)
    if (lockout) return lockout

    await deleteAuthenticationMethod(guard.user.sub, id)
    return NextResponse.json({ configured: true, removed: id })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
