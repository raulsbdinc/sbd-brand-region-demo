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
