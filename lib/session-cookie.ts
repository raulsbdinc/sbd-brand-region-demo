// SHARED SESSION-COOKIE WRITER
// ============================
// The Auth0 nextjs-auth0 SDK (v4) never stores a session as one raw cookie: its
// cookie layer (dist/server/cookies.js `setChunkedCookie`) splits any encrypted
// payload larger than MAX_CHUNK_SIZE into `__session__0`, `__session__1`, …, and
// getSession() reads them back combined. Our sign-in routes mint their own
// session via generateSessionCookie() and used to set ONE `__session` cookie by
// hand — which the browser SILENTLY DROPS once the encrypted value exceeds the
// ~4096-byte per-cookie limit. A large shared Model 1/2 account (linked
// passcode + Google identities, login_alias_emails, multi-site sbd_sites
// history → bigger id_token/access_token + more custom claims) is exactly the
// case that overflows, so its password grant returned 200 {ok:true} while no
// usable session cookie ever reached the app host. A smaller per-brand (Model 4)
// account fit in one cookie and worked — the differential in the live report.
//
// This module reproduces the SDK's chunking EXACTLY (same MAX_CHUNK_SIZE, same
// `__`-index naming, same base-vs-chunk mutual exclusion and stale-chunk
// clearing) so a session we mint is byte-compatible with what getSession()
// expects to read. planSessionCookieWrites is pure and unit-tested; applies via
// applySessionCookie onto any NextResponse. No claims are trimmed and no
// behaviour changes — a validated credential now ALWAYS yields a usable session.

export const SESSION_COOKIE_NAME = "__session"
// generateSessionCookie() hard-codes a 1-hour expiry, so cookie maxAge matches.
export const SESSION_TTL_SECONDS = 60 * 60

// Must mirror @auth0/nextjs-auth0 dist/server/cookies.js.
const MAX_CHUNK_SIZE = 3500 // slightly under 4KB
const CHUNK_PREFIX = "__"

/** One cookie mutation the caller should apply to the response. */
export type SessionCookieWrite =
  | { op: "set"; name: string; value: string; maxAge: number }
  | { op: "delete"; name: string }

/** True when `cookieName` is a chunk of the base session cookie `name`. */
function isChunkOf(name: string, cookieName: string): boolean {
  return new RegExp(`^${name}${CHUNK_PREFIX}\\d+$`).test(cookieName)
}

/**
 * Plan the exact set/delete operations to persist an encrypted session `value`
 * the way the SDK's cookie layer does, given the request's existing cookie
 * names (so stale chunks from a previous, differently-sized session are cleared).
 *
 * • value fits in one cookie  → set the base `__session`; delete every stale
 *   `__session__N` chunk.
 * • value overflows           → set `__session__0..k`; delete the base cookie
 *   and any leftover higher-index chunks.
 *
 * Byte length (not char length) decides chunking, matching the SDK. The value is
 * an encrypted JWE (URL-safe base64, all ASCII) so slicing by MAX_CHUNK_SIZE
 * chars yields ≤ MAX_CHUNK_SIZE-byte chunks and getSession's `.join("")`
 * reconstructs the original.
 */
export function planSessionCookieWrites(
  value: string,
  existingCookieNames: readonly string[] = [],
  opts: { name?: string; maxAge?: number } = {},
): SessionCookieWrite[] {
  const name = opts.name ?? SESSION_COOKIE_NAME
  const maxAge = opts.maxAge ?? SESSION_TTL_SECONDS
  const writes: SessionCookieWrite[] = []
  const staleChunks = existingCookieNames.filter((n) => isChunkOf(name, n))

  const byteLength = new TextEncoder().encode(value).length

  if (byteLength <= MAX_CHUNK_SIZE) {
    // Single cookie. Remove any chunks a previous larger session left behind.
    writes.push({ op: "set", name, value, maxAge })
    for (const chunk of staleChunks) writes.push({ op: "delete", name: chunk })
    return writes
  }

  // Chunked. Split by character position exactly as the SDK does.
  const writtenChunkNames = new Set<string>()
  let position = 0
  let chunkIndex = 0
  while (position < value.length) {
    const chunkName = `${name}${CHUNK_PREFIX}${chunkIndex}`
    writes.push({
      op: "set",
      name: chunkName,
      value: value.slice(position, position + MAX_CHUNK_SIZE),
      maxAge,
    })
    writtenChunkNames.add(chunkName)
    position += MAX_CHUNK_SIZE
    chunkIndex++
  }

  // Clear leftover higher-index chunks from a previous, longer session.
  for (const chunk of staleChunks) {
    if (!writtenChunkNames.has(chunk)) writes.push({ op: "delete", name: chunk })
  }
  // A chunked session must NOT leave a base cookie (getChunkedCookie prefers it).
  writes.push({ op: "delete", name })
  return writes
}

/** A minimal response-cookies surface (NextResponse.cookies satisfies this). */
export interface ResponseCookieSink {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean
      secure: boolean
      sameSite: "lax"
      path: string
      maxAge: number
    },
  ): unknown
}

/**
 * Apply a planned session write onto a response. `existingCookieNames` should be
 * the request's cookie names so stale chunks are cleared. Deletes are emitted as
 * an expired cookie with the same attributes so the browser reliably drops them.
 */
export function applySessionCookie(
  response: ResponseCookieSink,
  value: string,
  existingCookieNames: readonly string[] = [],
  opts: { name?: string; maxAge?: number } = {},
): void {
  for (const write of planSessionCookieWrites(value, existingCookieNames, opts)) {
    response.set(
      write.op === "set" ? write.name : write.name,
      write.op === "set" ? write.value : "",
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: write.op === "set" ? write.maxAge : 0,
      },
    )
  }
}
