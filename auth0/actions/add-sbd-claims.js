"use strict"

/**
 * Auth0 Post-Login Action: "Recognise SBD sites across brands".
 *
 * Scoped strictly to the three demo applications (DeWalt France, DeWalt Germany,
 * Stanley France) by client id. For ANY other client — including the older CIAM
 * proof of concept sharing this tenant — it returns immediately and touches
 * nothing.
 *
 * On a demo login it emits, on the ID token:
 *   • https://sbd.com/muid, /auth_method, /idp  — display/session identity.
 *   • email / email_verified                     — overridden to the chosen
 *                                                   app_metadata.primary_email.
 *   • https://sbd.demo/other_sites               — the OTHER demo sites this
 *                                                   account has signed into,
 *                                                   most recent first.
 * And, only for a JWT minted for the approved SBD API audience, on the access
 * token: https://sbd.com/roles and /muid.
 *
 * It records the current site into app_metadata.sbd_sites using the Actions
 * user API (api.user.setAppMetadata), which persists at the end of the login
 * transaction. It NEVER calls the Management API, searches users, links
 * identities, calls setPrimaryUser, or infers account ownership from a matching
 * email — so it needs no MGMT_* secrets. Trusted claim sources are app_metadata
 * plus the Auth0-supplied event fields.
 */

const IDENTITY_NAMESPACE = "https://sbd.com"
const DEMO_NAMESPACE = "https://sbd.demo"
const OTHER_SITES_CLAIM = `${DEMO_NAMESPACE}/other_sites`

const MAX_ROLES = 20
const MAX_ROLE_LENGTH = 64
const MAX_MUID_LENGTH = 128
const MAX_CONTEXT_LENGTH = 64
const MAX_SITE_ID_LENGTH = 64
const MAX_EMAIL_LENGTH = 254
const MAX_SITES = 32

const SAFE_VALUE = /^[a-zA-Z0-9._:@/-]+$/
// Auth0 user_ids look like "auth0|abc123", so a muid may contain a pipe.
const SAFE_MUID = /^[a-zA-Z0-9._:@/|-]+$/
// Deliberately permissive: a real email, trimmed, single "@", no whitespace.
const SAFE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The three demo applications this Action is scoped to, mapped to their stable
 * site id and human label. Any client id absent from this map is untouched.
 */
const DEMO_SITES_BY_CLIENT_ID = {
  BGDDy2XQqKEoHkjCaHcDyddwEB3yM1Va: { id: "dewalt-fr", label: "DeWalt France" },
  nucmPspqRd7fh8m77mvhx0VipdIx9zyP: { id: "dewalt-de", label: "DeWalt Germany" },
  "3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI": { id: "stanley-fr", label: "Stanley France" },
}

/** Known demo site id -> label, for labelling history entries other than the current site. */
const DEMO_SITE_LABELS = Object.values(DEMO_SITES_BY_CLIENT_ID).reduce((acc, site) => {
  acc[site.id] = site.label
  return acc
}, /** @type {Record<string, string>} */ ({}))

function boundedString(value, maxLength, pattern = SAFE_VALUE) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || !pattern.test(normalized)) {
    return null
  }
  return normalized
}

function normalizeRoles(value) {
  if (!Array.isArray(value)) return []

  const seen = new Set()
  const roles = []
  for (const candidate of value) {
    const role = boundedString(candidate, MAX_ROLE_LENGTH)
    if (!role) continue
    const key = role.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    roles.push(role)
    if (roles.length === MAX_ROLES) break
  }
  return roles
}

/**
 * The muid: the trusted app_metadata.muid when present, otherwise the trusted
 * Auth0 event.user.user_id, so existing live case-1/2 users (who have no
 * app_metadata.muid) keep their identity context. Never minted or defaulted.
 */
function resolveMuid(event) {
  const appMetadata = event?.user?.app_metadata || {}
  const fromMetadata = boundedString(appMetadata.muid, MAX_MUID_LENGTH, SAFE_MUID)
  if (fromMetadata) return fromMetadata
  return boundedString(event?.user?.user_id, MAX_MUID_LENGTH, SAFE_MUID)
}

function getIdentityClaims(event) {
  const authenticationMethod = Array.isArray(event?.authentication?.methods)
    ? event.authentication.methods.find((method) => method && typeof method.name === "string")?.name
    : null

  return {
    muid: resolveMuid(event),
    authMethod: boundedString(authenticationMethod, MAX_CONTEXT_LENGTH),
    idp: boundedString(event?.connection?.strategy, MAX_CONTEXT_LENGTH),
  }
}

function getAuthorizationClaims(event) {
  const appMetadata = event?.user?.app_metadata || {}
  return {
    roles: normalizeRoles(appMetadata.roles),
    muid: resolveMuid(event),
  }
}

/** The chosen display email, only when app_metadata.primary_email is a valid, bounded address. */
function getPrimaryEmail(event) {
  const appMetadata = event?.user?.app_metadata || {}
  return boundedString(appMetadata.primary_email, MAX_EMAIL_LENGTH, SAFE_EMAIL)
}

/** The demo site descriptor for this login's client id, or null for any other client. */
function resolveDemoSite(event) {
  const clientId = typeof event?.client?.client_id === "string" ? event.client.client_id : ""
  return Object.prototype.hasOwnProperty.call(DEMO_SITES_BY_CLIENT_ID, clientId)
    ? DEMO_SITES_BY_CLIENT_ID[clientId]
    : null
}

/**
 * Read the trusted app_metadata.sbd_sites history as a { siteId: isoTimestamp }
 * map, defensively. A missing/malformed map yields {}; a non-string timestamp
 * is kept as null so a bad entry can never throw or be treated as recent.
 */
function readSbdSites(event) {
  const raw = event?.user?.app_metadata?.sbd_sites
  const sites = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return sites
  for (const [id, timestamp] of Object.entries(raw)) {
    const siteId = boundedString(id, MAX_SITE_ID_LENGTH)
    if (!siteId) continue
    sites[siteId] = typeof timestamp === "string" && timestamp.trim() ? timestamp.trim() : null
  }
  return sites
}

/**
 * Build the https://sbd.demo/other_sites claim: every KNOWN demo site in the
 * history except the current one, most recent first. Entries without a parseable
 * timestamp sort last. Bounded to MAX_SITES.
 */
function buildOtherSites(sbdSites, currentSiteId) {
  const entries = []
  for (const [id, timestamp] of Object.entries(sbdSites)) {
    if (id === currentSiteId) continue
    const label = DEMO_SITE_LABELS[id]
    if (!label) continue // only surface known other demo sites
    entries.push({ id, label, lastSignIn: typeof timestamp === "string" ? timestamp : null })
  }

  entries.sort((a, b) => {
    const ta = a.lastSignIn ? Date.parse(a.lastSignIn) : NaN
    const tb = b.lastSignIn ? Date.parse(b.lastSignIn) : NaN
    const va = Number.isNaN(ta) ? -Infinity : ta
    const vb = Number.isNaN(tb) ? -Infinity : tb
    return vb - va // most recent first
  })

  return entries.slice(0, MAX_SITES)
}

/**
 * The next app_metadata.sbd_sites: existing string entries preserved, the
 * current site stamped with `nowIso`, bounded to the MAX_SITES most-recent ids.
 */
function nextSbdSites(sbdSites, currentSiteId, nowIso) {
  const next = {}
  for (const [id, timestamp] of Object.entries(sbdSites)) {
    if (typeof timestamp === "string" && timestamp.trim()) next[id] = timestamp.trim()
  }
  next[currentSiteId] = nowIso

  const ids = Object.keys(next)
  if (ids.length <= MAX_SITES) return next

  ids.sort((a, b) => {
    const va = Date.parse(next[a])
    const vb = Date.parse(next[b])
    return (Number.isNaN(vb) ? -Infinity : vb) - (Number.isNaN(va) ? -Infinity : va)
  })
  const trimmed = {}
  for (const id of ids.slice(0, MAX_SITES)) trimmed[id] = next[id]
  return trimmed
}

function isApprovedApiAudience(event) {
  const configuredAudience =
    typeof event?.secrets?.SBD_API_AUDIENCE === "string"
      ? event.secrets.SBD_API_AUDIENCE.trim()
      : ""
  const requestedAudience =
    typeof event?.resource_server?.identifier === "string"
      ? event.resource_server.identifier.trim()
      : ""

  return Boolean(configuredAudience && requestedAudience === configuredAudience)
}

exports.onExecutePostLogin = async (event, api) => {
  // SCOPE: only the three demo applications. Every other client is untouched.
  const site = resolveDemoSite(event)
  if (!site) return

  // ID token — identity/session context (https://sbd.com).
  const identity = getIdentityClaims(event)
  if (identity.muid) api.idToken.setCustomClaim(`${IDENTITY_NAMESPACE}/muid`, identity.muid)
  if (identity.authMethod) {
    api.idToken.setCustomClaim(`${IDENTITY_NAMESPACE}/auth_method`, identity.authMethod)
  }
  if (identity.idp) api.idToken.setCustomClaim(`${IDENTITY_NAMESPACE}/idp`, identity.idp)

  // ID token — chosen display email. `sub` never changes; only the email claim
  // reflects the address the customer designated as primary.
  const primaryEmail = getPrimaryEmail(event)
  if (primaryEmail) {
    api.idToken.setCustomClaim("email", primaryEmail)
    api.idToken.setCustomClaim("email_verified", true)
  }

  // ID token — cross-site recognition. Built from the trusted history BEFORE we
  // record the current visit, so the current site is never listed against itself.
  const sbdSites = readSbdSites(event)
  api.idToken.setCustomClaim(OTHER_SITES_CLAIM, buildOtherSites(sbdSites, site.id))

  // Persist the current site into the history via the Actions user API (NOT the
  // Management API). Guarded so an older api shape without setAppMetadata cannot
  // throw and break the login.
  if (api?.user && typeof api.user.setAppMetadata === "function") {
    api.user.setAppMetadata("sbd_sites", nextSbdSites(sbdSites, site.id, new Date().toISOString()))
  }

  // Access token — authorization, only for a JWT minted for the approved SBD API.
  if (!isApprovedApiAudience(event)) return

  const authorization = getAuthorizationClaims(event)
  if (authorization.roles.length > 0) {
    api.accessToken.setCustomClaim(`${IDENTITY_NAMESPACE}/roles`, authorization.roles)
  }
  if (authorization.muid) {
    api.accessToken.setCustomClaim(`${IDENTITY_NAMESPACE}/muid`, authorization.muid)
  }
}

exports._test = {
  DEMO_SITES_BY_CLIENT_ID,
  boundedString,
  buildOtherSites,
  getAuthorizationClaims,
  getIdentityClaims,
  getPrimaryEmail,
  isApprovedApiAudience,
  nextSbdSites,
  normalizeRoles,
  readSbdSites,
  resolveDemoSite,
  resolveMuid,
}
