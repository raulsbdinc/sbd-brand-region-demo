"use strict"

/**
 * Auth0 Post-Login Action: Add SBD custom claims.
 *
 * ID token (display/session context): muid, auth_method, idp.
 * Access token (API authorization): roles and muid, but only when Auth0 is
 * issuing a JWT for the exact API identifier in the SBD_API_AUDIENCE secret.
 *
 * Trusted claim sources are restricted to app_metadata. This Action never
 * creates identity data or writes metadata during login.
 */

const NAMESPACE = "https://sbd.com"
const MAX_ROLES = 20
const MAX_ROLE_LENGTH = 64
const MAX_MUID_LENGTH = 128
const MAX_CONTEXT_LENGTH = 64
const SAFE_VALUE = /^[a-zA-Z0-9._:@/-]+$/

function boundedString(value, maxLength) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || !SAFE_VALUE.test(normalized)) {
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

function getIdentityClaims(event) {
  const appMetadata = event?.user?.app_metadata || {}
  const authenticationMethod = Array.isArray(event?.authentication?.methods)
    ? event.authentication.methods.find((method) => method && typeof method.name === "string")?.name
    : null

  return {
    muid: boundedString(appMetadata.muid, MAX_MUID_LENGTH),
    authMethod: boundedString(authenticationMethod, MAX_CONTEXT_LENGTH),
    idp: boundedString(event?.connection?.strategy, MAX_CONTEXT_LENGTH),
  }
}

function getAuthorizationClaims(event) {
  const appMetadata = event?.user?.app_metadata || {}
  return {
    roles: normalizeRoles(appMetadata.roles),
    muid: boundedString(appMetadata.muid, MAX_MUID_LENGTH),
  }
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
  const identity = getIdentityClaims(event)

  if (identity.muid) api.idToken.setCustomClaim(`${NAMESPACE}/muid`, identity.muid)
  if (identity.authMethod) {
    api.idToken.setCustomClaim(`${NAMESPACE}/auth_method`, identity.authMethod)
  }
  if (identity.idp) api.idToken.setCustomClaim(`${NAMESPACE}/idp`, identity.idp)

  if (!isApprovedApiAudience(event)) return

  const authorization = getAuthorizationClaims(event)
  if (authorization.roles.length > 0) {
    api.accessToken.setCustomClaim(`${NAMESPACE}/roles`, authorization.roles)
  }
  if (authorization.muid) {
    api.accessToken.setCustomClaim(`${NAMESPACE}/muid`, authorization.muid)
  }
}

exports._test = {
  boundedString,
  getAuthorizationClaims,
  getIdentityClaims,
  isApprovedApiAudience,
  normalizeRoles,
}
