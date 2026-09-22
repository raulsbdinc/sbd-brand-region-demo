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
