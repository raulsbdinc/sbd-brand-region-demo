import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  DEFAULT_AUTH_REGION,
  HOSTING_REGIONS,
  REGION_COOKIE,
  marketsForTenant,
  tenantById,
} from "@/lib/regions"
import { COUNTRIES } from "@/lib/brands"
import type { CountryId } from "@/lib/types"
import { isAuthConfigured } from "@/lib/auth0"
import { regionAuthStatuses, isValidAuthRoute } from "@/lib/auth0-regions"

export const dynamic = "force-dynamic"

/**
 * Descriptors the switcher renders, merging the tenant model with live config.
 * Covers both display regions (from TENANTS) and per-country app overrides
 * (from COUNTRIES, e.g. Canada) so a country on its own app shows its own
 * hosting location and client id.
 */
function describeRegions() {
  return regionAuthStatuses().map((status) => {
    const id = status.id
    const tenant = tenantById(id)
    if (tenant) {
      const hosting = HOSTING_REGIONS[tenant.hosting]
      return {
        id,
        name: tenant.name,
        hostingCode: hosting?.code ?? "",
        hostingName: hosting?.name ?? "",
        markets: marketsForTenant(id).length,
        special: Boolean(tenant.special),
        configured: status.configured,
        dedicated: status.dedicated,
        clientId: status.clientId,
      }
    }
    // Per-country override key (id === country id, e.g. "ca").
    const country = COUNTRIES[id as CountryId]
    // Hosting region ids align with country codes (e.g. "ca").
    const hosting = HOSTING_REGIONS[id as keyof typeof HOSTING_REGIONS]
    return {
      id,
      name: country?.name ?? id,
      hostingCode: hosting?.code ?? country?.code ?? "",
      hostingName: hosting?.name ?? country?.name ?? "",
      markets: 1,
      special: false,
      configured: status.configured,
      dedicated: status.dedicated,
      clientId: status.clientId,
    }
  })
}

// GET /api/region — current selection + per-region status for the switcher.
export async function GET() {
  const store = await cookies()
  const raw = store.get(REGION_COOKIE)?.value
  const active = isValidAuthRoute(raw) ? (raw as string) : DEFAULT_AUTH_REGION
  return NextResponse.json({
    active,
    authConfigured: isAuthConfigured(),
    regions: describeRegions(),
  })
}

// POST /api/region — set the active region. Stored in a cookie the proxy reads
// to route /auth/* to the matching regional Auth0 tenant.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { region?: string }
  const region = body.region
  if (!isValidAuthRoute(region)) {
    return NextResponse.json({ error: "Unknown region." }, { status: 400 })
  }
  const store = await cookies()
  store.set(REGION_COOKIE, region as string, {
    path: "/",
    httpOnly: true,
    // SameSite=None;Secure so the selection survives the embedded preview iframe
    // and the broken-out Universal Login tab (mirrors the session-cookie setup).
    sameSite: "none",
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
  })
  return NextResponse.json({ active: region })
}
