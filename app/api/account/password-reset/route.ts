import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { createPasswordChangeTicket, getUser } from "@/lib/auth0-management"
import { resolveResetTarget } from "@/lib/credential-resolver"

// POST /api/account/password-reset
// Creates a real Auth0 password-change ticket for the signed-in user and
// returns the one-time URL. (We return the ticket URL rather than auto-emailing
// so the demo can show the result; in production you'd typically email it or
// rely on the Authentication API's password-reset email instead.)
//
// BODY (all optional):
//   { bindingId?: string }
//
//   • No body / no bindingId → reset the PRIMARY shared credential by user_id,
//     exactly as before (back-compat).
//   • bindingId → reset ONE individual per-email (case 3) or per-brand (case 4)
//     credential. The id is resolved and validated SERVER-SIDE against the
//     signed-in primary account's own bindings + real linked identities, then
//     the ticket is created with connection_id + email. An id that does not
//     belong to this account, is unbacked, or is not configured is rejected —
//     a client can never reset a credential that is not genuinely its own.
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let bindingId = ""
  try {
    const body = (await request.json()) as { bindingId?: unknown }
    bindingId = typeof body?.bindingId === "string" ? body.bindingId.trim() : ""
  } catch {
    // No/invalid JSON body → primary reset (back-compat).
  }

  try {
    // No binding id → reset the primary account credential exactly as before.
    if (!bindingId) {
      const { ticket } = await createPasswordChangeTicket({
        user_id: guard.user.sub,
        ttl_sec: 60 * 30, // 30 minutes
      })
      return NextResponse.json({ configured: true, ticket })
    }

    // Binding id → validate it against the signed-in primary account, then
    // reset that one credential by connection_id + email.
    const primaryUser = await getUser(guard.user.sub)
    const target = resolveResetTarget(primaryUser, bindingId)
    if (!target) {
      // Neutral rejection — never reveal whether the id exists, is unbacked, or
      // is simply not configured.
      return NextResponse.json(
        { error: "That credential can't be reset." },
        { status: 400 },
      )
    }

    const { ticket } = await createPasswordChangeTicket({
      connection_id: target.connectionId,
      email: target.email,
      ttl_sec: 60 * 30, // 30 minutes
    })
    return NextResponse.json({
      configured: true,
      ticket,
      credential: { label: target.label, email: target.email },
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
