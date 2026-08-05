// OKTA / AUTH0 MANAGEMENT API CLIENT (server-only)
// =================================================
// This is the server-to-server bridge that promotes the /account "Demo" actions
// (profile/email updates, password-reset tickets, MFA, passkeys, account
// linking, organizations, data export, deletion) to the real Auth0 Management
// API (https://<tenant>/api/v2).
//
// CREDENTIALS: per the team decision we reuse the EXISTING Regular Web App
// credentials (AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET) via the OAuth2
// `client_credentials` grant. For that to work the app must be AUTHORIZED for
// the Management API in the Auth0 dashboard with the required scopes — see
// FEATURE_BACKLOG.md Part 3. If you would rather isolate admin privileges, create a
// dedicated M2M app and set AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET;
// this module prefers those when present and silently falls back to the login
// app credentials otherwise.
//
// SAFETY: every helper here is server-only and unauthenticated at this layer —
// the calling route handlers are responsible for verifying the session and
// scoping every call to the signed-in user's own `sub`. Never import this from
// a client component.

import "server-only"

const MGMT_TOKEN_MARGIN_MS = 60_000 // refresh a minute before expiry

interface CachedToken {
  accessToken: string
  expiresAt: number // epoch ms
}

let cachedToken: CachedToken | null = null

/** The Management API client id: dedicated M2M app if provided, else the login app. */
function mgmtClientId(): string | undefined {
  return process.env.AUTH0_MGMT_CLIENT_ID || process.env.AUTH0_CLIENT_ID
}

/** The Management API client secret: dedicated M2M app if provided, else the login app. */
function mgmtClientSecret(): string | undefined {
  return process.env.AUTH0_MGMT_CLIENT_SECRET || process.env.AUTH0_CLIENT_SECRET
}

/** Bare tenant domain, e.g. "stanley-black-decker-consumer.us.auth0.com". */
function tenantDomain(): string | undefined {
  return process.env.AUTH0_DOMAIN
}

/**
 * Whether the Management API is fully configured. When false, route handlers
 * return `{ configured: false }` and the UI keeps its Demo simulation. We only
 * need a domain + a client id/secret pair; the audience is derived from the
 * domain.
 */
export function isManagementConfigured(): boolean {
  return Boolean(tenantDomain() && mgmtClientId() && mgmtClientSecret())
}

/** The Management API audience for this tenant. */
function mgmtAudience(): string {
  return `https://${tenantDomain()}/api/v2/`
}

class ManagementError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ManagementError"
    this.status = status
  }
}

export { ManagementError }

/**
 * Fetch (and cache) a Management API access token via client_credentials.
 * Tokens are cached in module memory until shortly before they expire.
 */
async function getMgmtToken(): Promise<string> {
  if (!isManagementConfigured()) {
    throw new ManagementError("Management API is not configured", 501)
  }

  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt - MGMT_TOKEN_MARGIN_MS > now) {
    return cachedToken.accessToken
  }

  const res = await fetch(`https://${tenantDomain()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: mgmtClientId(),
      client_secret: mgmtClientSecret(),
      audience: mgmtAudience(),
    }),
    // Never cache the token request at the fetch layer.
    cache: "no-store",
  })

  if (!res.ok) {
    const detail = await safeText(res)
    throw new ManagementError(
      `Failed to obtain Management API token (${res.status}). ${detail}`,
      res.status,
    )
  }

  const json = (await res.json()) as {
    access_token: string
    expires_in: number
  }
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  }
  return json.access_token
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text()
    return t.slice(0, 500)
  } catch {
    return ""
  }
}

/**
 * Low-level authenticated request to the Management API. Returns parsed JSON
 * (or `null` for empty 204 responses). Throws `ManagementError` on non-2xx.
 */
async function mgmtFetch<T>(
  pathAndQuery: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getMgmtToken()
  const res = await fetch(`https://${tenantDomain()}/api/v2${pathAndQuery}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const detail = await safeText(res)
    throw new ManagementError(
      `Management API ${init?.method ?? "GET"} ${pathAndQuery} failed (${res.status}). ${detail}`,
      res.status,
    )
  }

  if (res.status === 204) return null as T
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

// --- Typed surface used by the account routes ------------------------------

export interface Auth0Identity {
  connection: string
  provider: string
  user_id: string
  isSocial?: boolean
  profileData?: Record<string, unknown>
}

export interface Auth0Enrollment {
  id: string
  status: "confirmed" | "pending"
  type: string // e.g. "totp", "sms", "push-notification", "webauthn-roaming"
  name?: string
  identifier?: string
  enrolledAt?: string
  last_auth?: string
  auth_method?: string
}

export interface Auth0User {
  user_id: string
  email?: string
  email_verified?: boolean
  name?: string
  nickname?: string
  picture?: string
  given_name?: string
  family_name?: string
  created_at?: string
  updated_at?: string
  last_login?: string
  logins_count?: number
  blocked?: boolean
  identities?: Auth0Identity[]
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

export interface Auth0OrganizationMembership {
  id: string
  name: string
  display_name?: string
  branding?: { logo_url?: string }
}

/** GET /users/{id} — the full user record. */
export function getUser(userId: string): Promise<Auth0User> {
  return mgmtFetch<Auth0User>(`/users/${encodeURIComponent(userId)}`)
}

/**
 * GET /users-by-email — look up users by email address (database connections).
 * Returns every matching record; a caller filtering to a single account should
 * disambiguate (e.g. prefer a blocked user, or require a unique match).
 */
export function getUsersByEmail(email: string): Promise<Auth0User[]> {
  return mgmtFetch<Auth0User[]>(
    `/users-by-email?email=${encodeURIComponent(email.toLowerCase())}`,
  )
}

/**
 * PATCH /users/{id} — update profile fields. Only a safe allowlist is accepted
 * by the route; this client doesn't restrict, so callers must sanitize.
 */
export function updateUser(
  userId: string,
  body: Record<string, unknown>,
): Promise<Auth0User> {
  return mgmtFetch<Auth0User>(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

/** DELETE /users/{id} — irreversible hard delete (guarded by the route). */
export function deleteUser(userId: string): Promise<null> {
  return mgmtFetch<null>(`/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  })
}

/** GET /users/{id}/enrollments — MFA factors (Guardian). */
export function getMfaEnrollments(userId: string): Promise<Auth0Enrollment[]> {
  return mgmtFetch<Auth0Enrollment[]>(
    `/users/${encodeURIComponent(userId)}/enrollments`,
  )
}

/** DELETE /guardian/enrollments/{id} — remove one MFA factor. */
export function deleteMfaEnrollment(enrollmentId: string): Promise<null> {
  return mgmtFetch<null>(
    `/guardian/enrollments/${encodeURIComponent(enrollmentId)}`,
    { method: "DELETE" },
  )
}

/** GET /users/{id}/authentication-methods — includes passkeys (type webauthn). */
export function getAuthenticationMethods(
  userId: string,
): Promise<
  Array<{
    id: string
    type: string
    name?: string
    created_at?: string
    last_auth_at?: string
    key_id?: string
  }>
> {
  return mgmtFetch(
    `/users/${encodeURIComponent(userId)}/authentication-methods`,
  )
}

/** DELETE one authentication method (e.g. a passkey) by id. */
export function deleteAuthenticationMethod(
  userId: string,
  methodId: string,
): Promise<null> {
  return mgmtFetch<null>(
    `/users/${encodeURIComponent(userId)}/authentication-methods/${encodeURIComponent(methodId)}`,
    { method: "DELETE" },
  )
}

/**
 * POST /users/{id}/authentication-methods — register a confirmed TOTP factor
 * from a secret we already generated and verified server-side. Because we pass
 * `totp_secret`, Auth0 stores the factor as active without running its own
 * enrolment challenge — the challenge already happened on our side, which is the
 * whole point of enrolling inside our own page. Requires the
 * `create:authentication_methods` scope on the Management grant.
 */
export function enrollTotpAuthenticator(
  userId: string,
  totpSecret: string,
  name: string,
): Promise<{ id: string; type: string; name?: string; created_at?: string }> {
  return mgmtFetch(
    `/users/${encodeURIComponent(userId)}/authentication-methods`,
    {
      method: "POST",
      body: JSON.stringify({ type: "totp", totp_secret: totpSecret, name }),
    },
  )
}

/** GET /users/{id}/organizations — org memberships (Auth0 Organizations). */
export function getUserOrganizations(
  userId: string,
): Promise<Auth0OrganizationMembership[]> {
  return mgmtFetch<Auth0OrganizationMembership[]>(
    `/users/${encodeURIComponent(userId)}/organizations`,
  )
}

export interface Auth0OrganizationInvitation {
  id: string
  organization_id: string
  invitation_url?: string
  created_at?: string
  expires_at?: string
  invitee: { email: string }
}

/** POST /organizations/{id}/invitations — invite one user into an organization. */
export function createOrganizationInvitation(
  organizationId: string,
  body: { email: string; inviterName: string },
): Promise<Auth0OrganizationInvitation> {
  const clientId = process.env.AUTH0_CLIENT_ID
  if (!clientId) throw new ManagementError("Auth0 application client id is missing", 501)
  return mgmtFetch<Auth0OrganizationInvitation>(
    `/organizations/${encodeURIComponent(organizationId)}/invitations`,
    {
      method: "POST",
      body: JSON.stringify({
        inviter: { name: body.inviterName },
        invitee: { email: body.email },
        client_id: clientId,
        send_invitation_email: true,
        app_metadata: { requested_role: "pro-member" },
      }),
    },
  )
}

/**
 * POST /tickets/password-change — create a password-reset ticket. Returns a
 * one-time URL the user can follow. (You can also trigger an email instead via
 * the Authentication API; the ticket approach keeps everything server-side.)
 */
export function createPasswordChangeTicket(body: {
  user_id: string
  result_url?: string
  ttl_sec?: number
  mark_email_as_verified?: boolean
}): Promise<{ ticket: string }> {
  return mgmtFetch<{ ticket: string }>(`/tickets/password-change`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/**
 * POST /dbconnections/change_password — asks Auth0 to email its standard
 * password-reset message. Auth0 deliberately returns a generic response so the
 * public recovery route does not need to look users up or disclose existence.
 */
export async function requestPasswordResetEmail(
  email: string,
  connection: string,
): Promise<void> {
  const domain = tenantDomain()
  const clientId = process.env.AUTH0_CLIENT_ID
  if (!domain || !clientId) {
    throw new ManagementError("Auth0 is not configured", 501)
  }
  const response = await fetch(`https://${domain}/dbconnections/change_password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, email, connection }),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new ManagementError(
      `Password reset request failed (${response.status}). ${await safeText(response)}`,
      response.status,
    )
  }
}

/** POST /jobs/verification-email — resend verification for one scoped user. */
export function sendVerificationEmail(userId: string): Promise<{ id: string }> {
  return mgmtFetch<{ id: string }>(`/jobs/verification-email`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  })
}

/** Identity linking: POST /users/{id}/identities. */
export function linkIdentity(
  primaryUserId: string,
  body:
    | { link_with: string }
    | { provider: string; user_id: string; connection_id?: string },
): Promise<Auth0Identity[]> {
  return mgmtFetch<Auth0Identity[]>(
    `/users/${encodeURIComponent(primaryUserId)}/identities`,
    { method: "POST", body: JSON.stringify(body) },
  )
}

/** Identity unlinking: DELETE /users/{id}/identities/{provider}/{secondaryId}. */
export function unlinkIdentity(
  primaryUserId: string,
  provider: string,
  secondaryUserId: string,
): Promise<Auth0Identity[]> {
  return mgmtFetch<Auth0Identity[]>(
    `/users/${encodeURIComponent(primaryUserId)}/identities/${encodeURIComponent(provider)}/${encodeURIComponent(secondaryUserId)}`,
    { method: "DELETE" },
  )
}

// --- Consolidated "ways you sign in" --------------------------------------
// A consumer doesn't think in terms of "identities" vs "authentication
// methods" — they think "the ways I can sign in." This normalizes both Auth0
// concepts (linked identities + passkeys) into one list the account center can
// render, and powers the lockout guard that stops a user removing their last
// way in.

const PASSKEY_TYPE_PREFIXES = ["passkey", "webauthn-roaming", "webauthn-platform"]

export interface LoginMethod {
  /** Stable key for React + for the DELETE call. */
  key: string
  kind: "password" | "social" | "passkey"
  label: string
  detail?: string
  /** The account anchor (the identity equal to `sub`) — never removable. */
  isPrimary: boolean
  removable: boolean
  // Removal coordinates (set depending on kind):
  provider?: string // identity unlink
  userId?: string // identity unlink (secondary id)
  methodId?: string // passkey delete
}

/** Map an Auth0 identity provider to a friendly label + kind. */
function providerLabel(provider: string): {
  label: string
  kind: "password" | "social"
} {
  switch (provider) {
    case "auth0":
      return { label: "Email & password", kind: "password" }
    case "google-oauth2":
      return { label: "Google", kind: "social" }
    case "apple":
      return { label: "Apple", kind: "social" }
    case "windowslive":
      return { label: "Microsoft", kind: "social" }
    case "facebook":
      return { label: "Facebook", kind: "social" }
    case "github":
      return { label: "GitHub", kind: "social" }
    case "linkedin":
      return { label: "LinkedIn", kind: "social" }
    case "twitter":
      return { label: "X", kind: "social" }
    default:
      return { label: provider, kind: "social" }
  }
}

/**
 * Build the unified list of a user's sign-in methods (linked identities +
 * passkeys), flagging which are removable. The identity equal to `sub` is the
 * primary anchor and is never removable.
 */
export async function getLoginMethods(sub: string): Promise<{
  methods: LoginMethod[]
  total: number
  removableCount: number
}> {
  const [user, authMethods] = await Promise.all([
    getUser(sub),
    getAuthenticationMethods(sub).catch(() => []),
  ])

  const methods: LoginMethod[] = []

  for (const id of user.identities ?? []) {
    const composite = `${id.provider}|${id.user_id}`
    const isPrimary = composite === sub
    const { label, kind } = providerLabel(id.provider)
    methods.push({
      key: composite,
      kind,
      label,
      detail: (id.profileData?.email as string | undefined) ?? undefined,
      isPrimary,
      removable: !isPrimary,
      provider: id.provider,
      userId: id.user_id,
    })
  }

  for (const m of authMethods ?? []) {
    if (!PASSKEY_TYPE_PREFIXES.some((t) => m.type?.startsWith(t))) continue
    methods.push({
      key: `passkey:${m.id}`,
      kind: "passkey",
      label: m.name || "Passkey",
      detail: m.created_at
        ? `Added ${new Date(m.created_at).toLocaleDateString()}`
        : undefined,
      isPrimary: false,
      removable: true,
      methodId: m.id,
    })
  }

  return {
    methods,
    total: methods.length,
    removableCount: methods.filter((x) => x.removable).length,
  }
}
