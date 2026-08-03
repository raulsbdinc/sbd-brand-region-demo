import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser } from "@/lib/auth0-management"
import { REGION_COOKIE } from "@/lib/regions"
import {
  buildErasurePlan,
  ERASURE_GRACE_PERIOD_DAYS,
  ERASURE_SLA_DAYS,
  type ErasureReceipt,
} from "@/lib/erasure"

// GET /api/account/erasure
// Machine-visible right-to-be-forgotten surface. Returns:
//   - plan:    the region-aware cascade the account center previews BEFORE a
//              deletion, and an auditor can inspect at any time.
//   - receipt: the recorded erasure receipt (from app_metadata) if the user has
//              already requested erasure — null otherwise.
//   - retention + webhookConfigured: the governing timings and whether the
//              downstream cascade webhook is wired up.
//
// The plan is derived from the selected region and is always returned (it holds
// no sensitive data), so the UI can preview the cascade even in Demo. `live`
// tells the client whether the receipt reflects the real directory.
export const dynamic = "force-dynamic"

export async function GET() {
  const cookieStore = await cookies()
  const region = cookieStore.get(REGION_COOKIE)?.value ?? null
  const plan = buildErasurePlan(region)

  const base = {
    plan,
    retention: {
      gracePeriodDays: ERASURE_GRACE_PERIOD_DAYS,
      slaDays: ERASURE_SLA_DAYS,
    },
    webhookConfigured: Boolean(process.env.SBD_ERASURE_WEBHOOK_URL),
  }

  const guard = await requireAccountUser({ requireManagement: true })
  if (!guard.ok) {
    // Demo or unauthenticated: still return the plan preview, flagged not-live.
    return NextResponse.json({ ...base, live: false, receipt: null })
  }

  try {
    const user = await getUser(guard.user.sub)
    const receipt =
      (user.app_metadata?.erasure as ErasureReceipt | undefined) ?? null
    return NextResponse.json({ ...base, live: true, receipt })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
