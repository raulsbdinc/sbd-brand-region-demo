import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
  ensureNotLastLoginMethod,
} from "@/lib/account-guard"
import {
  getMfaEnrollments,
  deleteMfaEnrollment,
  getAuthenticationMethods,
  deleteAuthenticationMethod,
} from "@/lib/auth0-management"

// /api/account/mfa
//   GET    → list the signed-in user's MFA factors.
//   DELETE → remove one factor by id (?id=...), after verifying it belongs to
//            the signed-in user and that it isn't their last way to sign in.
//
// ENROLLING an authenticator now happens inside our own page — see
// /api/account/mfa/enroll/{start,verify}. Listing and removal stay here.
//
// A TOTP factor enrolled through the Management `authentication-methods`
// endpoint surfaces there, while older Guardian factors (sms/push) surface under
// `/enrollments`. We read BOTH and merge them (deduped) so whatever a user has
// is listed, and route each delete to the endpoint that owns the id.
export const dynamic = "force-dynamic"

interface FactorView {
  id: string
  type: string
  status: string
  name?: string
  createdAt?: string
  /** Which API owns this id, so DELETE hits the right endpoint. */
  source: "authentication-method" | "guardian"
}

/** Normalize an id for dedup — Guardian and auth-methods may prefix with type. */
function normalizeId(id: string): string {
  const bar = id.indexOf("|")
  return bar >= 0 ? id.slice(bar + 1) : id
}

async function listFactors(sub: string): Promise<FactorView[]> {
  const [authMethods, guardian] = await Promise.all([
    getAuthenticationMethods(sub).catch(() => []),
    getMfaEnrollments(sub).catch(() => []),
  ])

  const factors: FactorView[] = []

  // TOTP (and any other) authenticator methods — the endpoint we enroll through.
  for (const m of authMethods ?? []) {
    if (m.type === "totp") {
      factors.push({
        id: m.id,
        type: "totp",
        status: "confirmed",
        name: m.name,
        createdAt: m.created_at,
        source: "authentication-method",
      })
    }
  }

  // Guardian enrollments (sms / push / older totp), skipping any already listed.
  const seen = new Set(factors.map((f) => normalizeId(f.id)))
  for (const e of guardian ?? []) {
    if (seen.has(normalizeId(e.id))) continue
    factors.push({
      id: e.id,
      type: e.type,
      status: e.status,
      name: e.name,
      createdAt: e.enrolledAt,
      source: "guardian",
    })
  }

  return factors
}

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const enrollments = await listFactors(guard.user.sub)
    return NextResponse.json({
      configured: true,
      enabled: enrollments.some((e) => e.status === "confirmed"),
      enrollments,
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const id = new URL(request.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "Missing enrollment id." }, { status: 400 })
  }

  try {
    // Verify the factor is actually the signed-in user's before deleting — the
    // delete endpoints are keyed only by id.
    const owned = await listFactors(guard.user.sub)
    const factor = owned.find((f) => f.id === id)
    if (!factor) {
      return NextResponse.json(
        { error: "Factor not found for this account." },
        { status: 404 },
      )
    }

    // Never let anyone strand themselves without a way to sign in.
    const lockout = await ensureNotLastLoginMethod(guard.user.sub)
    if (lockout) return lockout

    if (factor.source === "authentication-method") {
      await deleteAuthenticationMethod(guard.user.sub, id)
    } else {
      await deleteMfaEnrollment(id)
    }
    return NextResponse.json({ configured: true, removed: id })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
