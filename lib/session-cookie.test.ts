import { test } from "node:test"
import assert from "node:assert/strict"
import {
  planSessionCookieWrites,
  applySessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  type SessionCookieWrite,
} from "./session-cookie.ts"

// Mirror the SDK constants so the test proves byte-compatibility, not just our
// own arithmetic.
const MAX_CHUNK_SIZE = 3500
const CHUNK_PREFIX = "__"

/** Reconstruct a session value the way @auth0/nextjs-auth0 getChunkedCookie does:
 *  prefer the base cookie; otherwise concatenate `__session__N` in index order. */
function readBack(writes: SessionCookieWrite[]): string | undefined {
  const set = new Map<string, string>()
  for (const w of writes) if (w.op === "set") set.set(w.name, w.value)
  const base = set.get(SESSION_COOKIE_NAME)
  if (base !== undefined) return base
  const chunks = [...set.entries()]
    .filter(([n]) => new RegExp(`^${SESSION_COOKIE_NAME}${CHUNK_PREFIX}\\d+$`).test(n))
    .sort(
      ([a], [b]) =>
        Number(a.slice((SESSION_COOKIE_NAME + CHUNK_PREFIX).length)) -
        Number(b.slice((SESSION_COOKIE_NAME + CHUNK_PREFIX).length)),
    )
  if (chunks.length === 0) return undefined
  return chunks.map(([, v]) => v).join("")
}

test("small session (Model 4 sized) → one base cookie, readable, TTL applied", () => {
  const value = "a".repeat(1200)
  const writes = planSessionCookieWrites(value)
  const sets = writes.filter((w) => w.op === "set")
  assert.equal(sets.length, 1)
  assert.equal(sets[0].name, SESSION_COOKIE_NAME)
  assert.equal(sets[0].op === "set" && sets[0].maxAge, SESSION_TTL_SECONDS)
  assert.equal(readBack(writes), value)
})

test("value exactly at the 3500-byte limit stays a single cookie", () => {
  const value = "b".repeat(MAX_CHUNK_SIZE)
  const writes = planSessionCookieWrites(value)
  const sets = writes.filter((w) => w.op === "set")
  assert.equal(sets.length, 1)
  assert.equal(sets[0].name, SESSION_COOKIE_NAME)
  assert.equal(readBack(writes), value)
})

test("large session (shared Model 1/2 sized) → chunked, base removed, round-trips", () => {
  // ~9KB: the class of payload the browser silently dropped as one cookie.
  const value = "c".repeat(9000)
  const writes = planSessionCookieWrites(value)
  const sets = writes.filter((w) => w.op === "set")
  // 9000 / 3500 → 3 chunks.
  assert.equal(sets.length, 3)
  assert.deepEqual(
    sets.map((w) => w.name),
    [`${SESSION_COOKIE_NAME}__0`, `${SESSION_COOKIE_NAME}__1`, `${SESSION_COOKIE_NAME}__2`],
  )
  // Every chunk fits under the per-cookie limit.
  for (const w of sets) {
    if (w.op === "set") assert.ok(new TextEncoder().encode(w.value).length <= MAX_CHUNK_SIZE)
  }
  // Base cookie must be explicitly deleted so getChunkedCookie reads the chunks.
  assert.ok(
    writes.some((w) => w.op === "delete" && w.name === SESSION_COOKIE_NAME),
    "chunked session must delete the base cookie",
  )
  // Full fidelity: chunks reassemble to the exact original value.
  assert.equal(readBack(writes), value)
})

test("shrinking session clears stale higher-index chunks left by a previous login", () => {
  const value = "d".repeat(1000) // now fits in one cookie
  const existing = [
    SESSION_COOKIE_NAME,
    `${SESSION_COOKIE_NAME}__0`,
    `${SESSION_COOKIE_NAME}__1`,
    `${SESSION_COOKIE_NAME}__2`,
  ]
  const writes = planSessionCookieWrites(value, existing)
  // Base cookie set; all three prior chunks deleted.
  assert.ok(writes.some((w) => w.op === "set" && w.name === SESSION_COOKIE_NAME))
  for (const idx of [0, 1, 2]) {
    assert.ok(
      writes.some((w) => w.op === "delete" && w.name === `${SESSION_COOKIE_NAME}__${idx}`),
      `stale chunk ${idx} must be deleted`,
    )
  }
  assert.equal(readBack(writes), value)
})

test("re-login with fewer chunks deletes only the now-unused higher chunks", () => {
  const value = "e".repeat(4000) // → 2 chunks (0,1)
  const existing = [
    `${SESSION_COOKIE_NAME}__0`,
    `${SESSION_COOKIE_NAME}__1`,
    `${SESSION_COOKIE_NAME}__2`,
    `${SESSION_COOKIE_NAME}__3`,
  ]
  const writes = planSessionCookieWrites(value, existing)
  const sets = writes.filter((w) => w.op === "set")
  assert.equal(sets.length, 2)
  // chunks 2 and 3 are stale → deleted; 0 and 1 are rewritten, not deleted.
  assert.ok(writes.some((w) => w.op === "delete" && w.name === `${SESSION_COOKIE_NAME}__2`))
  assert.ok(writes.some((w) => w.op === "delete" && w.name === `${SESSION_COOKIE_NAME}__3`))
  assert.ok(!writes.some((w) => w.op === "delete" && w.name === `${SESSION_COOKIE_NAME}__0`))
  assert.ok(!writes.some((w) => w.op === "delete" && w.name === `${SESSION_COOKIE_NAME}__1`))
  assert.equal(readBack(writes), value)
})

test("chunking DECISION is byte-based (matches the SDK), not char-based", () => {
  // 2000 code points that each encode to 3 bytes → 6000 bytes > MAX_CHUNK_SIZE,
  // even though the string LENGTH (2000) is under it. The SDK decides to chunk
  // by byte length, so this must take the chunked branch: the base cookie is
  // removed and the payload lives under `__session__N`. (Real sessions are ASCII
  // base64url JWE where char length == byte length, so this is only a guard that
  // the size DECISION never regresses to char length.)
  const value = "あ".repeat(2000)
  const writes = planSessionCookieWrites(value)
  assert.ok(
    writes.some((w) => w.op === "delete" && w.name === SESSION_COOKIE_NAME),
    "a >4KB-byte value must take the chunked branch and delete the base cookie",
  )
  assert.ok(
    writes.some((w) => w.op === "set" && w.name === `${SESSION_COOKIE_NAME}__0`),
    "chunked payload must be stored under an indexed chunk name",
  )
})

test("applySessionCookie writes secure, httpOnly, lax, path=/ options and expires deletes", () => {
  const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = []
  const sink = {
    set(name: string, value: string, options: Record<string, unknown>) {
      calls.push({ name, value, options })
    },
  }
  const value = "f".repeat(9000)
  applySessionCookie(sink, value, [`${SESSION_COOKIE_NAME}__5`])
  // Every write carries the hardened cookie attributes.
  for (const c of calls) {
    assert.equal(c.options.httpOnly, true)
    assert.equal(c.options.secure, true)
    assert.equal(c.options.sameSite, "lax")
    assert.equal(c.options.path, "/")
  }
  // Sets carry the TTL; deletes expire immediately.
  const base = calls.find((c) => c.name === SESSION_COOKIE_NAME)
  assert.ok(base && base.options.maxAge === 0, "base cookie deleted for chunked session")
  const chunk0 = calls.find((c) => c.name === `${SESSION_COOKIE_NAME}__0`)
  assert.ok(chunk0 && chunk0.options.maxAge === SESSION_TTL_SECONDS)
  const stale = calls.find((c) => c.name === `${SESSION_COOKIE_NAME}__5`)
  assert.ok(stale && stale.options.maxAge === 0 && stale.value === "")
})
