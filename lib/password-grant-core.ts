import { PROVIDER_ATTEMPT_TIMEOUT_MS, sendBounded } from "./management-retry.ts"

/**
 * Framework-free core of the password-realm exchange, so the timing and the
 * provider-error mapping can be unit tested without server-only imports.
 *
 * A password attempt is sent exactly once. It is never retried: every attempt
 * counts toward Auth0 brute-force protection, and repeating it would only hold
 * the customer's request longer.
 */

export interface PasswordGrantTokens {
  access_token: string
  id_token: string
  scope?: string
  expires_in?: number
  token_type?: string
}

export type PasswordGrantOutcome =
  | { kind: "ok"; tokens: PasswordGrantTokens }
  /** Auth0 checked the credentials and refused them (wrong password, blocked). */
  | { kind: "refused" }
  /** Auth0 attack protection or rate limiting refused the attempt for now. */
  | { kind: "throttled"; retryAfterSeconds?: number }
  /** Timeout, network failure, provider error or unusable response. */
  | { kind: "unavailable" }

const CREDENTIAL_REFUSAL_CODES = new Set([
  "invalid_grant",
  "invalid_user_password",
  "unauthorized",
  "access_denied",
  "mfa_required",
  "password_leaked",
])

/** Map a failed token-endpoint response to what actually happened. */
export function classifyPasswordGrantFailure(
  status: number,
  errorCode: string | undefined,
): "refused" | "throttled" | "unavailable" {
  if (status === 429 || errorCode === "too_many_attempts") return "throttled"
  if (status >= 500) return "unavailable"
  if ((status === 401 || status === 403) && errorCode && CREDENTIAL_REFUSAL_CODES.has(errorCode)) {
    return "refused"
  }
  return "unavailable"
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined
  const n = Number(header)
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined
}

export async function runPasswordGrant(params: {
  fetchImpl: typeof fetch
  domain: string
  body: Record<string, string>
  firstHop?: string
  /** Absolute epoch-ms deadline shared with the rest of the interactive request. */
  deadlineAt?: number
  timeoutMs?: number
  now?: () => number
}): Promise<PasswordGrantOutcome> {
  const now = params.now ?? Date.now
  const timeoutMs = params.timeoutMs ?? PROVIDER_ATTEMPT_TIMEOUT_MS
  const budget =
    params.deadlineAt === undefined
      ? timeoutMs
      : Math.min(timeoutMs, params.deadlineAt - now())
  if (budget <= 0) return { kind: "unavailable" }

  let res: Response
  try {
    res = await sendBounded(
      (signal) =>
        params.fetchImpl(`https://${params.domain}/oauth/token`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(params.firstHop ? { "auth0-forwarded-for": params.firstHop } : {}),
          },
          body: JSON.stringify(params.body),
          cache: "no-store",
          signal,
        }),
      budget,
    )
  } catch {
    return { kind: "unavailable" }
  }

  if (res.ok) {
    try {
      const json = (await res.json()) as Partial<PasswordGrantTokens>
      if (!json.access_token || !json.id_token) return { kind: "unavailable" }
      return { kind: "ok", tokens: json as PasswordGrantTokens }
    } catch {
      return { kind: "unavailable" }
    }
  }

  let errorCode: string | undefined
  try {
    const json = (await res.json()) as { error?: unknown }
    if (typeof json.error === "string") errorCode = json.error
  } catch {
    errorCode = undefined
  }

  const kind = classifyPasswordGrantFailure(res.status, errorCode)
  if (kind === "throttled") {
    return { kind, retryAfterSeconds: retryAfterSeconds(res.headers.get("retry-after")) }
  }
  return { kind }
}

/** Customer-facing copy, identical on every storefront. */
export const SIGNIN_REFUSED_MESSAGE = "That email or password isn't right."
export const SIGNIN_THROTTLED_MESSAGE =
  "Too many sign-in attempts. Wait a few minutes and try again."
export const SIGNIN_UNAVAILABLE_MESSAGE =
  "Sign-in is temporarily unavailable. Try again in a moment."

/**
 * The HTTP response for a sign-in that did not produce a session. A credential
 * refusal keeps the single generic 401 (no enumeration). Throttling and
 * provider failure are reported as what they are, never as bad credentials.
 */
export function signinFailureResponse(
  kind: "refused" | "throttled" | "unavailable",
  retryAfter?: number,
): { status: number; body: { error: string; code?: string }; headers?: Record<string, string> } {
  if (kind === "refused") return { status: 401, body: { error: SIGNIN_REFUSED_MESSAGE } }
  if (kind === "throttled") {
    return {
      status: 429,
      body: { error: SIGNIN_THROTTLED_MESSAGE, code: "throttled" },
      ...(retryAfter !== undefined ? { headers: { "retry-after": String(retryAfter) } } : {}),
    }
  }
  return {
    status: 503,
    body: { error: SIGNIN_UNAVAILABLE_MESSAGE, code: "provider-unavailable" },
  }
}

/** Total time the interactive password sign-in may spend on provider calls. */
export const INTERACTIVE_SIGNIN_BUDGET_MS = 12_000
/** Share of that budget the account lookup may use before the password check. */
export const INTERACTIVE_LOOKUP_BUDGET_MS = 6_000
