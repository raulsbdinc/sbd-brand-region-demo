// CONSENT AUDIT TRAIL (server-only)
// =================================
// A best-effort, append-only record of consent changes, kept in Neon Postgres
// when DATABASE_URL is configured and writes succeed. This is the missing half of consent management: Auth0
// `user_metadata.consent` stores the *current state* + a single "last updated"
// stamp (see lib/metadata-schema.ts), but GDPR/CCPA accountability requires a
// durable, per-change record of WHO changed WHAT, from WHICH value to WHICH,
// and WHEN — metadata is not an audit log (FEATURE_BACKLOG.md Part 4 §4.9 #3).
//
// Design rules:
//   • APPEND-ONLY. Rows are only ever INSERTed. Nothing here updates or deletes
//     history — that is the whole point of an audit trail.
//   • SCOPED BY `user_sub`. There is no RLS on this connection, so every read is
//     filtered by the signed-in user's Auth0 `sub`. Callers pass the `sub` from
//     the account route guard; a client can never supply someone else's id.
//   • Parameterized SQL only (via @neondatabase/serverless tagged templates) so
//     values can never be interpolated into the statement text.
//
// This app authenticates with Auth0 (not Better Auth), so Neon is used purely
// as this audit store — there is no ORM and no shared auth pool.

import "server-only"
import { neon } from "@neondatabase/serverless"
import { CONSENT_TOPICS, type ConsentState, type ConsentTopic } from "./metadata-schema"

/** Whether the audit store is wired up (DATABASE_URL present). */
export function isConsentAuditConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

function sql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

/** "granted" when a topic flips true, "withdrawn" when it flips false. */
export type ConsentAction = "granted" | "withdrawn"

/** One recorded change to a single consent topic. */
export interface ConsentAuditEntry {
  id: number
  topic: ConsentTopic
  action: ConsentAction
  previousValue: boolean | null
  newValue: boolean
  source: string
  createdAt: string
}

/** A pending change computed from a diff, before it is written. */
export interface ConsentChange {
  topic: ConsentTopic
  action: ConsentAction
  previousValue: boolean | null
  newValue: boolean
}

/**
 * Compute the per-topic changes between a previous and next consent state.
 * `previous` may be null when the user has never recorded consent before — in
 * that case only topics being turned ON are logged (turning an already-off
 * topic "off" is not a change worth recording).
 */
export function diffConsent(
  previous: ConsentState | null,
  next: ConsentState,
): ConsentChange[] {
  const changes: ConsentChange[] = []
  for (const { value: topic } of CONSENT_TOPICS) {
    const prev = previous ? previous[topic] : null
    const now = next[topic]
    // No baseline: only record grants (a fresh opt-in).
    if (prev === null) {
      if (now) changes.push({ topic, action: "granted", previousValue: null, newValue: true })
      continue
    }
    if (prev !== now) {
      changes.push({
        topic,
        action: now ? "granted" : "withdrawn",
        previousValue: prev,
        newValue: now,
      })
    }
  }
  return changes
}

/**
 * Append consent changes to the audit log. No-ops when there is nothing to
 * record. Failures are swallowed (logged only) so that an audit-store hiccup
 * never blocks the user from actually saving their consent — the source of
 * truth for current state is still Auth0 metadata.
 */
export async function recordConsentChanges(
  userSub: string,
  changes: ConsentChange[],
  source = "account_center",
): Promise<void> {
  if (changes.length === 0) return
  try {
    const db = sql()
    // Small N (≤ number of consent topics), so sequential parameterized
    // inserts are fine and keep each statement simple.
    for (const c of changes) {
      await db`
        INSERT INTO consent_audit_log
          (user_sub, topic, action, previous_value, new_value, source)
        VALUES
          (${userSub}, ${c.topic}, ${c.action}, ${c.previousValue}, ${c.newValue}, ${source})
      `
    }
  } catch (err) {
    console.log(
      "[v0] consent audit write failed:",
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Read the most recent audit entries for a user, newest first. Always scoped by
 * `user_sub`. Returns an empty array on any failure so the UI degrades to "no
 * history yet" instead of erroring.
 */
export async function getConsentAuditLog(
  userSub: string,
  limit = 50,
): Promise<ConsentAuditEntry[]> {
  try {
    const db = sql()
    const rows = (await db`
      SELECT id, topic, action, previous_value, new_value, source, created_at
      FROM consent_audit_log
      WHERE user_sub = ${userSub}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `) as Record<string, unknown>[]

    return rows.map((r) => ({
      id: Number(r.id),
      topic: r.topic as ConsentTopic,
      action: r.action as ConsentAction,
      previousValue:
        r.previous_value === null || r.previous_value === undefined
          ? null
          : Boolean(r.previous_value),
      newValue: Boolean(r.new_value),
      source: String(r.source),
      createdAt:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
    }))
  } catch (err) {
    console.log(
      "[v0] consent audit read failed:",
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}
