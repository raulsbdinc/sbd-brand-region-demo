import { NextResponse } from "next/server"
import { requireAccountUser } from "@/lib/account-guard"
import { getConsentAuditLog } from "@/lib/consent-audit"

// /api/account/consent/audit
//   GET → consent-change rows that were successfully written to Neon, newest
//         first and scoped to the signed-in user's Auth0 `sub`.
//
// This is a best-effort append-only companion to /api/account/consent, which
// stores the current state in Auth0 metadata. See lib/consent-audit.ts
// and FEATURE_BACKLOG.md Part 4 §4.9 #3.
//
// Gated by the same guard as the rest of the account center: when there is no
// real session / the Management API isn't configured, the client transparently
// falls back to its Demo history.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const entries = await getConsentAuditLog(guard.user.sub)
  return NextResponse.json({ configured: true, entries })
}
