/**
 * How long to wait before repeating a Management API call that Auth0 refused
 * with 429, or null when the call should fail instead of being retried.
 *
 * The add-another-email guard reads every account in the directory. Auth0's
 * Management API allows only a short burst, so a handful of those reads come
 * back 429. Treating that as "directory unavailable" rejects a mailbox the
 * person just proved they own. A 429 means the call was not applied, so
 * waiting and sending it again is safe for reads and writes alike.
 */
export function managementRetryDelayMs(params: {
  status: number
  /** Zero-based count of retries already performed for this call. */
  attempt: number
  retryAfterHeader: string | null
  rateLimitResetHeader: string | null
  nowMs: number
}): number | null {
  if (params.status !== 429) return null
  if (params.attempt >= 5) return null

  const retryAfterSeconds = headerSeconds(params.retryAfterHeader)
  if (retryAfterSeconds !== null) return clampDelay(retryAfterSeconds * 1000)

  const resetSeconds = headerSeconds(params.rateLimitResetHeader)
  if (resetSeconds !== null && resetSeconds > 0) {
    const wait = resetSeconds * 1000 - params.nowMs
    if (wait > 0) return clampDelay(wait)
  }

  return clampDelay(250 * 2 ** params.attempt)
}

function headerSeconds(value: string | null): number | null {
  if (value == null || value.trim() === "") return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function clampDelay(ms: number): number {
  return Math.min(Math.max(ms, 200), 5000)
}

/** Longest a single provider HTTP attempt may take before it is aborted. */
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 8_000

/**
 * Total time one Management call may spend, including 429 waits, when the
 * caller supplies no tighter deadline. Keeps background reads bounded too.
 */
export const MANAGEMENT_DEFAULT_CALL_BUDGET_MS = 30_000

/** A provider attempt that ran out of time, or a deadline already spent. */
export class ProviderTimeoutError extends Error {
  readonly status = 504
  constructor(message: string) {
    super(message)
    this.name = "ProviderTimeoutError"
  }
}

/**
 * Run one provider request with a hard time limit. The signal passed to `send`
 * is aborted when the limit is reached, and the returned promise rejects with
 * ProviderTimeoutError even if `send` ignores the signal.
 */
export async function sendBounded(
  send: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) throw new ProviderTimeoutError("Provider deadline already reached")
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the race settles with the timeout, not the abort error.
      reject(new ProviderTimeoutError(`Provider request exceeded ${timeoutMs} ms`))
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([send(controller.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send a Management request, waiting out a 429 only while the wait still fits
 * inside the deadline. Returns the final Response (ok, a non-retryable error,
 * or the last 429 when no further wait fits). Throws ProviderTimeoutError when
 * the deadline is spent or an attempt times out; network errors propagate.
 */
export async function sendWithRetryBudget(params: {
  send: (signal: AbortSignal) => Promise<Response>
  /** Absolute epoch-ms deadline. Defaults to now + MANAGEMENT_DEFAULT_CALL_BUDGET_MS. */
  deadlineAt?: number
  attemptTimeoutMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<Response> {
  const now = params.now ?? Date.now
  const sleep =
    params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const attemptTimeoutMs = params.attemptTimeoutMs ?? PROVIDER_ATTEMPT_TIMEOUT_MS
  const deadlineAt = params.deadlineAt ?? now() + MANAGEMENT_DEFAULT_CALL_BUDGET_MS

  for (let attempt = 0; ; attempt++) {
    const remaining = deadlineAt - now()
    if (remaining <= 0) throw new ProviderTimeoutError("Provider deadline already reached")

    const res = await sendBounded(params.send, Math.min(attemptTimeoutMs, remaining))
    if (res.ok) return res

    const delay = managementRetryDelayMs({
      status: res.status,
      attempt,
      retryAfterHeader: res.headers.get("retry-after"),
      rateLimitResetHeader: res.headers.get("x-ratelimit-reset"),
      nowMs: now(),
    })
    if (delay === null || now() + delay >= deadlineAt) return res

    await res.body?.cancel().catch(() => {})
    await sleep(delay)
  }
}
