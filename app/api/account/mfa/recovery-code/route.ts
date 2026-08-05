import { NextResponse } from "next/server"
import { requireAccountUser, managementErrorResponse } from "@/lib/account-guard"
import { regenerateRecoveryCode } from "@/lib/auth0-management"

// /api/account/mfa/recovery-code
//   POST → generate a fresh single backup code for the signed-in account and
//          return it to the client.
//
// CRITICAL: Auth0 returns this value EXACTLY ONCE and it can never be retrieved
// again. We hand it straight back to the browser and deliberately do NOT
// persist it and do NOT log it anywhere. Regenerating replaces any previous
// code, so it's also the only way to "see" one again.
//
// Same session guard, token source and error handling as the other account
// routes; the failure message on screen stays friendly while the technical
// reason is logged server-side by managementErrorResponse (never the code).
export const dynamic = "force-dynamic"

export async function POST() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const { recovery_code } = await regenerateRecoveryCode(guard.user.sub)
    return NextResponse.json({ configured: true, recoveryCode: recovery_code })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
