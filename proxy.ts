// Next.js 16 renames middleware.ts -> proxy.ts. The Auth0 SDK uses this network
// boundary to mount its /auth/* routes and to keep the session cookie rolling.
// This does not interfere with the mock showcase — it only manages real Auth0
// sessions and the live auth routes.
import { NextRequest, NextResponse } from "next/server"
import { isAuthConfigured } from "./lib/auth0"
import { brandAccessEnforced } from "./lib/brand-access"
import {
  decideBrandSessionGate,
  sessionProbeRequest,
} from "./lib/brand-session-gate"
import { SITE_MARKET } from "./lib/site"
import {
  getRegionAuth0Client,
  regionFromCookieHeader,
} from "./lib/auth0-regions"

// Until the Auth0 env vars are present, bypass the SDK entirely so the rest of
// the app (the mock showcase) keeps working. The /live page renders its own
// "not configured yet" state in this case.
//
// MULTI-REGION: the visitor's chosen region (the `sbd_region` cookie set by the
// header's region switcher) decides which regional Auth0 tenant handles the
// /auth/* routes and the rolling session. Today every region falls back to the
// shared POC app, so this is transparent; once per-region tenants are wired up,
// switching region switches the backing tenant with no code change.
export async function proxy(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.next()
  }
  const region = regionFromCookieHeader(request.headers.get("cookie"))
  const client = getRegionAuth0Client(region)

  // EU brand gate: an SDK-callback session is PENDING until the reconcile route
  // proves brand enrollment server-side. Enforced here — before any page, the
  // SDK's /auth/profile or a protected API runs — not in client code.
  if (brandAccessEnforced(SITE_MARKET)) {
    let user: Record<string, unknown> | null = null
    try {
      const session = await client.getSession(
        new NextRequest(sessionProbeRequest(request)),
      )
      user = (session?.user as Record<string, unknown> | undefined) ?? null
    } catch {
      user = null
    }
    const { pathname } = new URL(request.url)
    const gate = decideBrandSessionGate({ market: SITE_MARKET, user, pathname })
    if (gate.action === "redirect") {
      return NextResponse.redirect(new URL(gate.location, request.url))
    }
    if (gate.action === "anonymous") {
      return NextResponse.json(
        { user: null, claims: null },
        { headers: { "cache-control": "no-store" } },
      )
    }
    if (gate.action === "deny") {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "cache-control": "no-store" } },
      )
    }
  }

  return await client.middleware(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
}
