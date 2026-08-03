// /api/account/passport — the SBD Passport (cross-region account map).
// ====================================================================
// GET    — read the signed-in user's passport (home region + linked regions).
// POST   — link a regional account   (body: { region }).
// DELETE — unlink a regional account (body: { region }).
//
// SAFETY (see lib/account-guard.ts): every call is gated by requireAccountUser()
// and scoped to the session user's own `sub`. The client never supplies a user
// id. When the Management API isn't configured, the guard returns
// `{ configured: false }` (200) and the page falls back to its Demo passport.
//
// RESIDENCY: the passport is stored in the HOME tenant's
// `app_metadata.sbd_passport` and holds IDENTIFIERS ONLY (see lib/passport.ts).
// Writes shallow-merge just the `sbd_passport` key, so sibling app_metadata
// (muid, roles, home_region) is preserved — same pattern as the consent route.

import { NextResponse } from "next/server"
import { requireAccountUser, managementErrorResponse } from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import { DEFAULT_AUTH_REGION, isValidAuthRegion } from "@/lib/regions"
import {
  newPassportLink,
  sanitizePassportLinks,
  type PassportLink,
} from "@/lib/passport"

export const dynamic = "force-dynamic"

interface StoredPassport {
  links?: unknown
  updated_at?: string
}

function homeRegionOf(appMetadata: Record<string, unknown> | undefined): string {
  const home = appMetadata?.home_region
  return typeof home === "string" && isValidAuthRegion(home) ? home : DEFAULT_AUTH_REGION
}

function passportPayload(homeRegion: string, links: PassportLink[], updatedAt: string | null, email?: string) {
  return {
    configured: true,
    live: true,
    homeEmail: email ?? null,
    passport: { homeRegion, links, updatedAt },
  }
}

// GET — read the passport.
export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    const home = homeRegionOf(user.app_metadata)
    const stored = (user.app_metadata?.sbd_passport ?? {}) as StoredPassport
    const links = sanitizePassportLinks(stored.links, home)
    return NextResponse.json(
      passportPayload(home, links, stored.updated_at ?? null, user.email),
    )
  } catch (err) {
    return managementErrorResponse(err)
  }
}

// POST — link a regional account.
export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const body = (await request.json().catch(() => ({}))) as { region?: string }
  const region = body.region

  try {
    const user = await getUser(guard.user.sub)
    const home = homeRegionOf(user.app_metadata)

    if (!isValidAuthRegion(region) || region === home) {
      return NextResponse.json({ error: "Unknown or invalid region." }, { status: 400 })
    }

    const stored = (user.app_metadata?.sbd_passport ?? {}) as StoredPassport
    const existing = sanitizePassportLinks(stored.links, home)
    if (existing.some((l) => l.region === region)) {
      return NextResponse.json(
        { error: "That region is already linked." },
        { status: 409 },
      )
    }

    const links = [...existing, newPassportLink(region as string, user.email ?? "")]
    const updated_at = new Date().toISOString()
    await updateUser(guard.user.sub, {
      app_metadata: { sbd_passport: { links, updated_at } },
    })
    return NextResponse.json(passportPayload(home, links, updated_at, user.email))
  } catch (err) {
    return managementErrorResponse(err)
  }
}

// DELETE — unlink a regional account.
export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  const body = (await request.json().catch(() => ({}))) as { region?: string }
  const region = body.region

  try {
    const user = await getUser(guard.user.sub)
    const home = homeRegionOf(user.app_metadata)
    const stored = (user.app_metadata?.sbd_passport ?? {}) as StoredPassport
    const existing = sanitizePassportLinks(stored.links, home)
    const links = existing.filter((l) => l.region !== region)
    const updated_at = new Date().toISOString()
    await updateUser(guard.user.sub, {
      app_metadata: { sbd_passport: { links, updated_at } },
    })
    return NextResponse.json(passportPayload(home, links, updated_at, user.email))
  } catch (err) {
    return managementErrorResponse(err)
  }
}
