// SBD CUSTOM CLAIMS
// =================
// Single definition of the namespaced custom claims that the SBD post-login
// Auth0 Action injects into the ID and access tokens. Auth0 requires custom
// claims to be namespaced with a URL, so every SBD-specific claim lives under
// `https://sbd.com/...`.
//
// Both the MOCK token builder (`lib/auth-service.ts`) and the REAL-session
// readers (`/welcome`, the token inspector) import these constants, so the
// claim names can never drift between the simulated and live paths.
//
// The Action that produces these claims on a real login is committed at
// `auth0/actions/add-sbd-claims.js` and documented in FEATURE_BACKLOG.md Part 1.

export const SBD_CLAIM_NAMESPACE = "https://sbd.com"

export const SBD_CLAIMS = {
  roles: `${SBD_CLAIM_NAMESPACE}/roles`,
  muid: `${SBD_CLAIM_NAMESPACE}/muid`,
  authMethod: `${SBD_CLAIM_NAMESPACE}/auth_method`,
  idp: `${SBD_CLAIM_NAMESPACE}/idp`,
} as const

/** Display/session claims expected in an ID token from the production Action. */
export const SBD_ID_TOKEN_CLAIM_KEYS: string[] = [
  SBD_CLAIMS.muid,
  SBD_CLAIMS.authMethod,
  SBD_CLAIMS.idp,
]

/** Authorization claims expected only in a JWT for an approved SBD API audience. */
export const SBD_ACCESS_TOKEN_CLAIM_KEYS: string[] = [
  SBD_CLAIMS.roles,
  SBD_CLAIMS.muid,
]

/** All SBD keys retained for mock-token and generic decoded-token displays. */
export const SBD_CLAIM_KEYS: string[] = Array.from(
  new Set([...SBD_ID_TOKEN_CLAIM_KEYS, ...SBD_ACCESS_TOKEN_CLAIM_KEYS]),
)

export interface SbdClaims {
  roles: string[]
  muid: string | null
  authMethod: string | null
  idp: string | null
  /**
   * True when at least one valid namespaced SBD claim is present. In the
   * production contract, ID tokens carry display/session context while roles
   * appear only in access tokens for an approved SBD API audience.
   */
  present: boolean
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string")
  if (typeof value === "string" && value.length > 0) return [value]
  return []
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Read the SBD custom claims out of a decoded token payload or a session user
 * object. Safe to call on any real Auth0 user object — returns `present: false`
 * when the Action has not injected the claims.
 */
export function extractSbdClaims(
  source: Record<string, unknown> | null | undefined,
): SbdClaims {
  const roles = asStringArray(source?.[SBD_CLAIMS.roles])
  const muid = asString(source?.[SBD_CLAIMS.muid])
  return {
    roles,
    muid,
    authMethod: asString(source?.[SBD_CLAIMS.authMethod]),
    idp: asString(source?.[SBD_CLAIMS.idp]),
    present: roles.length > 0 || muid !== null,
  }
}

// CROSS-BRAND RECOGNITION CLAIM
// ============================
// A separate post-login Action records, on the user record, every demo site the
// account has signed into, and injects the list of the OTHER sites (excluding
// the current one, most recent first) into the ID token under this namespaced
// claim. Note the namespace is `https://sbd.demo` — distinct from the identity
// claims above under `https://sbd.com` — so it is spelled out here verbatim to
// match exactly what the Action emits. This code only consumes the claim; it
// never writes Auth0 config.
export const SBD_OTHER_SITES_CLAIM = "https://sbd.demo/other_sites"

/** One other demo site this account has already authenticated to. */
export interface OtherSite {
  /** Stable site id, e.g. "dewalt-fr". */
  id: string
  /** Human label, e.g. "DeWalt France". */
  label: string
  /** ISO-8601 timestamp of the last sign-in on that site, if provided. */
  lastSignIn: string | null
}

/**
 * Read the cross-brand "other sites" list out of a real Auth0 user object.
 *
 * Defensive by contract: this feeds the welcome page an executive sees on a
 * projector, so a missing or malformed claim must degrade to "no panel", never
 * throw. Returns [] when the claim is absent, not an array, or an entry lacks a
 * usable string `label`. A non-string `id` or `lastSignIn` is tolerated by
 * coercing to a safe default rather than dropping the entry.
 */
export function extractOtherSites(user: Record<string, unknown>): OtherSite[] {
  const raw = user?.[SBD_OTHER_SITES_CLAIM]
  if (!Array.isArray(raw)) return []

  const sites: OtherSite[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const label = record.label
    // A label is the one field we render as the headline fact; without a real
    // string there is nothing meaningful to show, so skip the entry.
    if (typeof label !== "string" || label.trim().length === 0) continue
    sites.push({
      id: typeof record.id === "string" ? record.id : "",
      label,
      lastSignIn: typeof record.lastSignIn === "string" ? record.lastSignIn : null,
    })
  }
  return sites
}
