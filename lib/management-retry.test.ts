import { test } from "node:test"
import assert from "node:assert/strict"
import { managementRetryDelayMs } from "./management-retry.ts"

const nowMs = 1_700_000_000_000

test("does not retry a Management error that is not a rate limit", () => {
  assert.equal(
    managementRetryDelayMs({
      status: 500,
      attempt: 0,
      retryAfterHeader: "1",
      rateLimitResetHeader: null,
      nowMs,
    }),
    null,
  )
})

test("waits for Auth0 Retry-After on a 429", () => {
  assert.equal(
    managementRetryDelayMs({
      status: 429,
      attempt: 0,
      retryAfterHeader: "1",
      rateLimitResetHeader: null,
      nowMs,
    }),
    1000,
  )
})

test("uses the rate-limit reset instant when Retry-After is absent", () => {
  assert.equal(
    managementRetryDelayMs({
      status: 429,
      attempt: 0,
      retryAfterHeader: null,
      rateLimitResetHeader: String(nowMs / 1000 + 2),
      nowMs,
    }),
    2000,
  )
})

test("backs off when Auth0 sends a 429 with no timing hint", () => {
  assert.equal(
    managementRetryDelayMs({
      status: 429,
      attempt: 2,
      retryAfterHeader: null,
      rateLimitResetHeader: null,
      nowMs,
    }),
    1000,
  )
})

test("stops retrying after five 429s so a stuck limit still fails closed", () => {
  assert.equal(
    managementRetryDelayMs({
      status: 429,
      attempt: 5,
      retryAfterHeader: "1",
      rateLimitResetHeader: null,
      nowMs,
    }),
    null,
  )
})
