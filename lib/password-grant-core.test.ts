import { test } from "node:test"
import assert from "node:assert/strict"
import {
  classifyPasswordGrantFailure,
  INTERACTIVE_LOOKUP_BUDGET_MS,
  INTERACTIVE_SIGNIN_BUDGET_MS,
  runPasswordGrant,
  signinFailureResponse,
  SIGNIN_REFUSED_MESSAGE,
} from "./password-grant-core.ts"
import { ProviderTimeoutError, sendWithRetryBudget } from "./management-retry.ts"

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

const BODY = { grant_type: "password-realm", username: "a@example.com", password: "x" }

/** A fetch that never answers unless it is aborted, like a stalled provider. */
function hangingFetch(calls: { n: number }): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    calls.n++
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })
  }) as typeof fetch
}

test("a stalled token endpoint is cut off at the timeout and reported as unavailable, not refused", async () => {
  const calls = { n: 0 }
  const started = Date.now()
  const outcome = await runPasswordGrant({
    fetchImpl: hangingFetch(calls),
    domain: "tenant.example",
    body: BODY,
    timeoutMs: 50,
  })
  const elapsed = Date.now() - started
  assert.deepEqual(outcome, { kind: "unavailable" })
  assert.equal(calls.n, 1, "the password attempt is sent exactly once")
  assert.ok(elapsed < 1000, `returned after ${elapsed} ms`)
})

test("the password attempt never outlives the shared request deadline", async () => {
  const calls = { n: 0 }
  const started = Date.now()
  const outcome = await runPasswordGrant({
    fetchImpl: hangingFetch(calls),
    domain: "tenant.example",
    body: BODY,
    deadlineAt: started + 40,
  })
  assert.deepEqual(outcome, { kind: "unavailable" })
  assert.ok(Date.now() - started < 1000)
})

test("a spent deadline sends no password attempt at all", async () => {
  const calls = { n: 0 }
  const outcome = await runPasswordGrant({
    fetchImpl: hangingFetch(calls),
    domain: "tenant.example",
    body: BODY,
    deadlineAt: Date.now() - 1,
  })
  assert.deepEqual(outcome, { kind: "unavailable" })
  assert.equal(calls.n, 0)
})

test("Auth0's credential refusal is the generic refusal and is not retried", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    return json(403, { error: "invalid_grant", error_description: "Wrong email or password." })
  }) as typeof fetch
  const outcome = await runPasswordGrant({ fetchImpl, domain: "t", body: BODY })
  assert.deepEqual(outcome, { kind: "refused" })
  assert.equal(calls, 1)
})

test("attack-protection throttling is reported as throttled with Retry-After, never as bad credentials", async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    return json(429, { error: "too_many_attempts" }, { "retry-after": "60" })
  }) as typeof fetch
  const outcome = await runPasswordGrant({ fetchImpl, domain: "t", body: BODY })
  assert.deepEqual(outcome, { kind: "throttled", retryAfterSeconds: 60 })
  assert.equal(calls, 1, "a throttled password attempt is not repeated")
})

test("provider errors and network failures are unavailable", async () => {
  const server = (async () => json(503, { error: "temporarily_unavailable" })) as typeof fetch
  assert.deepEqual(await runPasswordGrant({ fetchImpl: server, domain: "t", body: BODY }), {
    kind: "unavailable",
  })
  const network = (async () => {
    throw new TypeError("fetch failed")
  }) as typeof fetch
  assert.deepEqual(await runPasswordGrant({ fetchImpl: network, domain: "t", body: BODY }), {
    kind: "unavailable",
  })
})

test("a success without both tokens is not treated as a sign-in", async () => {
  const fetchImpl = (async () => json(200, { access_token: "a" })) as typeof fetch
  assert.deepEqual(await runPasswordGrant({ fetchImpl, domain: "t", body: BODY }), {
    kind: "unavailable",
  })
})

test("failure classification keeps refusal, throttling and outage separate", () => {
  assert.equal(classifyPasswordGrantFailure(403, "invalid_grant"), "refused")
  assert.equal(classifyPasswordGrantFailure(401, "invalid_user_password"), "refused")
  assert.equal(classifyPasswordGrantFailure(401, "too_many_attempts"), "throttled")
  assert.equal(classifyPasswordGrantFailure(429, undefined), "throttled")
  assert.equal(classifyPasswordGrantFailure(500, "invalid_grant"), "unavailable")
  assert.equal(classifyPasswordGrantFailure(400, "invalid_request"), "unavailable")
  assert.equal(classifyPasswordGrantFailure(403, undefined), "unavailable")
})

test("sign-in responses: 401 generic refusal, 429 throttled, 503 unavailable", () => {
  assert.deepEqual(signinFailureResponse("refused"), {
    status: 401,
    body: { error: SIGNIN_REFUSED_MESSAGE },
  })
  const throttled = signinFailureResponse("throttled", 60)
  assert.equal(throttled.status, 429)
  assert.equal(throttled.body.code, "throttled")
  assert.deepEqual(throttled.headers, { "retry-after": "60" })
  const unavailable = signinFailureResponse("unavailable")
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.body.code, "provider-unavailable")
  assert.notEqual(unavailable.body.error, SIGNIN_REFUSED_MESSAGE)
})

test("interactive budgets are bounded well under a browser timeout", () => {
  assert.ok(INTERACTIVE_LOOKUP_BUDGET_MS < INTERACTIVE_SIGNIN_BUDGET_MS)
  assert.ok(INTERACTIVE_SIGNIN_BUDGET_MS <= 15_000)
})

// The live defect: every Management lookup slept through up to five 429 waits
// of up to five seconds with no overall limit, and the lookups ran before the
// password check. A virtual clock reproduces that without real waiting.
function virtualClock(start = 1_700_000_000_000) {
  let t = start
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

test("Management 429 with a long Retry-After is not waited out past the deadline", async () => {
  const clock = virtualClock()
  let calls = 0
  const res = await sendWithRetryBudget({
    send: async () => {
      calls++
      return json(429, { error: "too_many_requests" }, { "retry-after": "60" })
    },
    deadlineAt: clock.now() + INTERACTIVE_LOOKUP_BUDGET_MS,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(res.status, 429)
  assert.ok(clock.now() - 1_700_000_000_000 <= INTERACTIVE_LOOKUP_BUDGET_MS)
  assert.ok(calls <= 2)
})

test("repeated Management 429s stop at the deadline instead of retrying for minutes", async () => {
  const clock = virtualClock()
  const started = clock.now()
  let calls = 0
  const res = await sendWithRetryBudget({
    send: async () => {
      calls++
      return json(429, {}, { "retry-after": "5" })
    },
    deadlineAt: started + INTERACTIVE_LOOKUP_BUDGET_MS,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(res.status, 429)
  assert.ok(clock.now() - started < INTERACTIVE_LOOKUP_BUDGET_MS)
  assert.equal(calls, 2, "one 5 s wait fits in 6 s, a second does not")
})

test("a Management 429 is still retried when the wait fits and then succeeds", async () => {
  const clock = virtualClock()
  let calls = 0
  const res = await sendWithRetryBudget({
    send: async () => {
      calls++
      return calls === 1 ? json(429, {}, { "retry-after": "1" }) : json(200, [])
    },
    deadlineAt: clock.now() + INTERACTIVE_LOOKUP_BUDGET_MS,
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(res.status, 200)
  assert.equal(calls, 2)
})

test("a stalled Management attempt is aborted and raises ProviderTimeoutError", async () => {
  const calls = { n: 0 }
  const started = Date.now()
  await assert.rejects(
    sendWithRetryBudget({
      send: (signal) => hangingFetch(calls)("https://t", { signal }),
      deadlineAt: started + 50,
    }),
    ProviderTimeoutError,
  )
  assert.ok(Date.now() - started < 1000)
})

test("non-429 Management errors are returned immediately without waiting", async () => {
  const clock = virtualClock()
  const started = clock.now()
  const res = await sendWithRetryBudget({
    send: async () => json(500, {}),
    now: clock.now,
    sleep: clock.sleep,
  })
  assert.equal(res.status, 500)
  assert.equal(clock.now(), started)
})
