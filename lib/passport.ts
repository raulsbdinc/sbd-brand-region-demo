// SBD PASSPORT — CROSS-REGION ACCOUNT MODEL
// =========================================
// The passport is the "account-linking map" from FEATURE_BACKLOG.md Part 1
// ("Can a user manage themselves across tenants?"). It ties a person's separate
// regional-tenant accounts together into one view so they can self-manage each
// one from a single place.
//
// The passport stores regional user identifiers, a display email, and a linked-at
// stamp. It does not store the full profile, consent, or security record. The
// intended production pattern would edit that data in its owning tenant after a
// separate regional sign-in. This POC does not prove account ownership,
// cross-tenant session handoff, or data-residency compliance.
//
// STORAGE: when the Management API is configured, the passport lives in the
// HOME tenant's `app_metadata.sbd_passport` (identifiers only). When it isn't,
// the UI synthesizes a clearly-labeled Demo passport instead.
//
// This module is intentionally framework-free (no "server-only") so both the
// API route and the client page can import the types + helpers.

import { AUTH_REGION_ORDER, DEFAULT_AUTH_REGION, isValidAuthRegion } from "./regions"

/** One linked regional account. Identifiers + display email only — never PII. */
export interface PassportLink {
  /** The auth region / tenant id (see lib/regions.ts TENANTS). */
  region: string
  /** That tenant's user_id for this person. An identifier, not profile data. */
  userId: string
  /** Display-only email, shown so the user recognizes the account. */
  email: string
  /** ISO timestamp of when the account was linked. */
  linkedAt: string
}

/** A person's passport: their home tenant + the regional accounts they linked. */
export interface Passport {
  /** The anchor tenant whose directory record holds the passport. */
  homeRegion: string
  /** Additional regional accounts connected to this person (excludes home). */
  links: PassportLink[]
  /** ISO timestamp of the last change, or null if never written. */
  updatedAt: string | null
}

/** Max links = every routable region except the home one. */
const MAX_LINKS = AUTH_REGION_ORDER.length

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : ""
}

/**
 * Merge a raw `app_metadata.sbd_passport.links`-ish value into a clean list,
 * keeping ONLY valid regions, dropping the home region and duplicates. Used to
 * read stored links AND to sanitize any incoming change — there is no path for
 * an unknown region or an arbitrary key to be persisted.
 */
export function sanitizePassportLinks(input: unknown, homeRegion: string): PassportLink[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>([homeRegion])
  const out: PassportLink[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const region = asString(r.region, 32)
    if (!isValidAuthRegion(region) || seen.has(region)) continue
    seen.add(region)
    out.push({
      region,
      userId: asString(r.userId, 128),
      email: asString(r.email, 254),
      linkedAt: asString(r.linkedAt, 40) || new Date().toISOString(),
    })
    if (out.length >= MAX_LINKS) break
  }
  return out
}

/**
 * Create a new link record for a region. In production the `userId` comes from
 * the OIDC login the user completes against that region's tenant; in this POC
 * we mint a placeholder identifier so the mapping is recorded. Either way the
 * value is an IDENTIFIER, never profile data.
 */
export function newPassportLink(region: string, email: string): PassportLink {
  const suffix = Math.random().toString(36).slice(2, 10)
  return {
    region,
    userId: `auth0|${region}-${suffix}`,
    email,
    linkedAt: new Date().toISOString(),
  }
}

/**
 * Build a plausible, clearly-labeled Demo passport for when the Management API
 * isn't wired up. Links one nearby region by default so the UI shows both the
 * "linked" and "available to link" states.
 */
export function synthesizePassport(opts: { homeRegion: string; email: string }): Passport {
  const home = isValidAuthRegion(opts.homeRegion) ? opts.homeRegion : DEFAULT_AUTH_REGION
  const candidate = AUTH_REGION_ORDER.find((r) => r !== home && r !== "china")
  const links: PassportLink[] = candidate
    ? [
        {
          region: candidate,
          userId: `auth0|${candidate}-demo`,
          email: opts.email,
          linkedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString(),
        },
      ]
    : []
  return { homeRegion: home, links, updatedAt: new Date().toISOString() }
}
