// PER-REGION AUTH0 CLIENTS (multi-tenant routing)
// ===============================================
// Turns the regional-tenant proposal in lib/regions.ts into a working feature:
// the app keeps one Auth0Client *per region* and the proxy picks one based on
// the visitor's selected region (the `sbd_region` cookie set by the header's
// region switcher).
//
// CONFIG MODEL — "same app for all instances, configured later":
// Each region resolves its credentials from region-suffixed env vars and FALLS
// BACK to the shared default when they are absent. So with only the existing
// AUTH0_* vars set, every region authenticates against the single POC app today;
// later, filling in e.g. AUTH0_DOMAIN_EMEA / AUTH0_CLIENT_ID_EMEA / ... points
// EMEA at its own EU-hosted tenant without any code change.
//
//   AUTH0_DOMAIN[_<REGION>]        e.g. AUTH0_DOMAIN_EMEA
//   AUTH0_CLIENT_ID[_<REGION>]
//   AUTH0_CLIENT_SECRET[_<REGION>]
//
// where <REGION> is AMERICAS | EMEA | APAC | JAPAN | CHINA.
//
// NOTE: the cookie-encryption secret (AUTH0_SECRET) is intentionally NOT
// per-region — it must be shared so the single `__session` cookie stays
// readable by the base client used for all session reads. See
// resolveRegionAuthConfig below.

import { Auth0Client } from "@auth0/nextjs-auth0/server"
import {
  AUTH_REGION_ORDER,
  DEFAULT_AUTH_REGION,
  REGION_COOKIE,
  isValidAuthRegion,
} from "./regions"
import { COUNTRY_AUTH_OVERRIDES } from "./brands"
import { authCallbackHandler } from "./auth-callback"

// PER-COUNTRY APP OVERRIDES
// -------------------------
// Some countries route sign-ins to their OWN Auth0 application rather than the
// shared region tenant (e.g. Canada → "SBD Signon Experience - Dewalt CA").
// Their route key is the country id and their env vars use an uppercased
// suffix, e.g. AUTH0_DOMAIN_CA / AUTH0_CLIENT_ID_CA / AUTH0_CLIENT_SECRET_CA.
const COUNTRY_SUFFIX: Record<string, string> = Object.fromEntries(
  COUNTRY_AUTH_OVERRIDES.map((id) => [id, id.toUpperCase()]),
)

/** Env-var suffix for each routable region + per-country app override. */
const REGION_SUFFIX: Record<string, string> = {
  americas: "AMERICAS",
  emea: "EMEA",
  apac: "APAC",
  japan: "JAPAN",
  china: "CHINA",
  ...COUNTRY_SUFFIX,
}

/** All auth route keys: the display regions plus per-country overrides. */
export const AUTH_ROUTE_KEY_ORDER: string[] = [
  ...AUTH_REGION_ORDER,
  ...COUNTRY_AUTH_OVERRIDES,
]

/** Whether an id is a routable auth target (a region OR a country override). */
export function isValidAuthRoute(id: string | null | undefined): boolean {
  return isValidAuthRegion(id) || Boolean(id && COUNTRY_AUTH_OVERRIDES.includes(id as never))
}

export interface RegionAuthConfig {
  domain?: string
  clientId?: string
  clientSecret?: string
  secret?: string
  audience?: string
  /** True when this region has its OWN dedicated tenant env vars (not the fallback). */
  dedicated: boolean
}

/**
 * Resolve a region's Auth0 credentials: region-specific vars first, then the
 * shared default. `dedicated` reports whether the region is pointing at its own
 * tenant (a region-specific domain was found) vs. sharing the POC app.
 */
export function resolveRegionAuthConfig(regionId: string): RegionAuthConfig {
  const suffix = REGION_SUFFIX[regionId]
  const regional = (base: string) =>
    suffix ? process.env[`${base}_${suffix}`] : undefined

  const domain = regional("AUTH0_DOMAIN") ?? process.env.AUTH0_DOMAIN
  const clientId = regional("AUTH0_CLIENT_ID") ?? process.env.AUTH0_CLIENT_ID
  const clientSecret =
    regional("AUTH0_CLIENT_SECRET") ?? process.env.AUTH0_CLIENT_SECRET
  const audience = regional("AUTH0_AUDIENCE") ?? process.env.AUTH0_AUDIENCE
  // COOKIE-ENCRYPTION SECRET MUST BE SHARED ACROSS ALL REGIONS.
  // There is a single `__session` cookie on one app/domain. The proxy rolls it
  // with the *region* client, but every session read (`/api/me`, `/account`,
  // `/live`, `/welcome`, `/passport`, token inspector, account guard) uses the
  // base client in lib/auth0.ts, which encrypts with the shared AUTH0_SECRET.
  // If a region used its own AUTH0_SECRET_<REGION>, the write/read secrets would
  // mismatch and the session would fail to decrypt on read (appearing logged
  // out with errors right after a successful login). So we always use the
  // shared secret for cookie encryption; per-region domain/clientId/clientSecret
  // still route the OAuth flow to that region's tenant.
  const secret = process.env.AUTH0_SECRET
  const dedicated = Boolean(suffix && regional("AUTH0_DOMAIN"))

  return { domain, clientId, clientSecret, secret, audience, dedicated }
}

/** Whether a region has a complete, usable set of credentials (own or fallback). */
export function isRegionAuthConfigured(regionId: string): boolean {
  const c = resolveRegionAuthConfig(regionId)
  return Boolean(c.domain && c.clientId && c.clientSecret && c.secret)
}

/** Whether a region is backed by its own dedicated tenant (vs. the shared POC app). */
export function regionHasDedicatedTenant(regionId: string): boolean {
  return resolveRegionAuthConfig(regionId).dedicated
}

// One Auth0Client per region, built lazily and cached for the process lifetime.
const clientCache = new Map<string, Auth0Client>()

/**
 * The Auth0Client for a region. Mirrors the options of the default client in
 * lib/auth0.ts (OIDC scopes, optional SBD API audience, no offline_access,
 * infer base URL from host), but bound to the region's resolved credentials.
 */
export function getRegionAuth0Client(regionId: string): Auth0Client {
  const id = isValidAuthRoute(regionId) ? regionId : DEFAULT_AUTH_REGION
  const cached = clientCache.get(id)
  if (cached) return cached

  const c = resolveRegionAuthConfig(id)
  const client = new Auth0Client({
    domain: c.domain,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    secret: c.secret,
    // Keep parity with lib/auth0.ts: OIDC profile plus optional API audience,
    // single un-chunked session cookie, return to /live, and the shared friendly
    // callback-error handler.
    onCallback: authCallbackHandler,
    authorizationParameters: {
      scope: "openid profile email",
      ...(c.audience ? { audience: c.audience } : {}),
    },
    signInReturnToPath: "/live",
  })
  clientCache.set(id, client)
  return client
}

/** Parse the selected region from a raw Cookie header, defaulting safely. */
export function regionFromCookieHeader(cookieHeader: string | null): string {
  if (!cookieHeader) return DEFAULT_AUTH_REGION
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${REGION_COOKIE}=([^;]+)`),
  )
  const raw = match ? decodeURIComponent(match[1]) : null
  return isValidAuthRoute(raw) ? (raw as string) : DEFAULT_AUTH_REGION
}

/**
 * All routable auth targets with their live configuration status (for the
 * switcher) — the display regions plus per-country app overrides (e.g. Canada).
 */
export function regionAuthStatuses() {
  return AUTH_ROUTE_KEY_ORDER.map((id) => {
    const c = resolveRegionAuthConfig(id)
    return {
      id,
      configured: isRegionAuthConfigured(id),
      dedicated: c.dedicated,
      // OAuth client IDs are public identifiers (sent in the browser during the
      // auth flow), so surfacing the active one for the tenancy-change toast is
      // safe. Secrets are never returned.
      clientId: c.clientId ?? null,
    }
  })
}
