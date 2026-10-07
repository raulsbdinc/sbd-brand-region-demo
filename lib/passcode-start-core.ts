// Brand-scoped passcode start (CIAM-20), framework-free so the real handler
// logic runs in unit tests with injected provider calls. ONE interactive
// deadline bounds every await: the credential lookup, the pre-send passwordless
// snapshot and the send. The handoff is returned only with the 200.

import type { SigninCredentialResolution } from "./brand-signin-core.ts"
import {
  PASSCODE_CONFLICT_MESSAGE,
  PASSCODE_NOT_REGISTERED_MESSAGE,
  PASSCODE_SEND_TIMEOUT_MS,
  PASSCODE_THROTTLED_MESSAGE,
  PASSCODE_UNAVAILABLE_MESSAGE,
  gateBrandPasscodeStart,
  passcodeSendFailure,
} from "./passcode-start-outcome.ts"

/** Whole-request budget for a brand passcode start (lookup + snapshot + send). */
export const PASSCODE_START_BUDGET_MS = 12_000

export const PASSCODE_INVALID_EMAIL_MESSAGE = "Enter a valid email address."

export interface BrandPasscodeStartDeps {
  now(): number
  resolve(email: string, opts: { deadlineAt: number }): Promise<SigninCredentialResolution>
  /** A still-valid prior brand-proof handoff for this email + brand, if any. */
  carryForward(email: string, now: number): { iat: number; preExistingPasswordlessSubs: string[] } | null
  /** Passwordless subs that exist BEFORE the send; null when the lookup failed. */
  snapshot(email: string, opts: { deadlineAt: number }): Promise<string[] | null>
  send(email: string, opts: { signal: AbortSignal }): Promise<void>
}

export interface BrandProofHandoff {
  flow: "brand-proof"
  email: string
  iat: number
  brand: string
  preExistingPasswordlessSubs: string[]
}

export type BrandPasscodeStartResult =
  | { status: 200; body: { ok: true }; handoff: BrandProofHandoff; maxAgeSeconds: number }
  | { status: 400 | 404 | 409 | 429 | 503; body: { code: string; error: string }; handoff?: undefined }

class DeadlineExceeded extends Error {}

/** Settle `promise` or reject once `deadlineAt` passes, whichever is first. */
export function withinDeadline<T>(promise: Promise<T>, deadlineAt: number, now: () => number): Promise<T> {
  const remaining = deadlineAt - now()
  if (remaining <= 0) {
    promise.catch(() => {})
    return Promise.reject(new DeadlineExceeded("deadline"))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded("deadline")), remaining)
  })
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The lowercased email from a parsed request body, or "" when missing/malformed. */
export function parsePasscodeEmail(body: unknown): string {
  const raw = (body as { email?: unknown } | null)?.email
  if (typeof raw !== "string") return ""
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL_SHAPE.test(email) ? email : ""
}

function refusal(status: 400 | 404 | 409 | 429 | 503, code: string, error: string): BrandPasscodeStartResult {
  return { status, body: { code, error } }
}

const unavailable = () => refusal(503, "provider-unavailable", PASSCODE_UNAVAILABLE_MESSAGE)

export async function runBrandPasscodeStart(
  input: {
    body: unknown
    siteBrand: string
    hasCreds: boolean
    handoffTtlSeconds: number
    budgetMs?: number
  },
  deps: BrandPasscodeStartDeps,
): Promise<BrandPasscodeStartResult> {
  const email = parsePasscodeEmail(input.body)
  if (!email) return refusal(400, "invalid-email", PASSCODE_INVALID_EMAIL_MESSAGE)
  if (!input.hasCreds) return unavailable()

  const startedAt = deps.now()
  const deadlineAt = startedAt + (input.budgetMs ?? PASSCODE_START_BUDGET_MS)
  const bounded = <T>(p: Promise<T>) => withinDeadline(p, deadlineAt, deps.now)

  let resolution: SigninCredentialResolution
  try {
    resolution = await bounded(deps.resolve(email, { deadlineAt }))
  } catch {
    resolution = { kind: "unavailable" }
  }

  // Decide BEFORE any send: another brand only, the wrong region and a
  // never-registered email stop here; a failed lookup is never "not registered".
  const gate = gateBrandPasscodeStart({
    resolutionKind: resolution.kind,
    resolvedConnectionKey: resolution.kind === "resolved" ? resolution.connectionKey : undefined,
    siteBrand: input.siteBrand,
  })
  if (gate === "unavailable") return unavailable()
  if (gate === "conflict") return refusal(409, "conflict", PASSCODE_CONFLICT_MESSAGE)
  if (gate === "not-registered") return refusal(404, "not-registered", PASSCODE_NOT_REGISTERED_MESSAGE)

  // Provenance snapshot, recorded BEFORE the send so verify can tell a stub
  // minted by this challenge from a pre-existing email-only account. A resend
  // inside a valid handoff keeps the original snapshot and expiry anchor. A
  // failed snapshot is a failed start: no send, no handoff.
  const carried = deps.carryForward(email, startedAt)
  let preExistingPasswordlessSubs: string[]
  if (carried) {
    preExistingPasswordlessSubs = carried.preExistingPasswordlessSubs
  } else {
    let snap: string[] | null
    try {
      snap = await bounded(deps.snapshot(email, { deadlineAt }))
    } catch {
      snap = null
    }
    if (!snap) return unavailable()
    preExistingPasswordlessSubs = snap
  }

  const remaining = deadlineAt - deps.now()
  if (remaining <= 0) return unavailable()
  try {
    const signal = AbortSignal.timeout(Math.min(remaining, PASSCODE_SEND_TIMEOUT_MS))
    await bounded(deps.send(email, { signal }))
  } catch (error) {
    const failure = passcodeSendFailure(error)
    return refusal(
      failure.status,
      failure.code,
      failure.code === "throttled" ? PASSCODE_THROTTLED_MESSAGE : PASSCODE_UNAVAILABLE_MESSAGE,
    )
  }

  const iat = carried?.iat ?? startedAt
  const elapsed = Math.floor((deps.now() - iat) / 1000)
  return {
    status: 200,
    body: { ok: true },
    handoff: { flow: "brand-proof", email, iat, brand: input.siteBrand, preExistingPasswordlessSubs },
    maxAgeSeconds: Math.max(1, input.handoffTtlSeconds - elapsed),
  }
}
