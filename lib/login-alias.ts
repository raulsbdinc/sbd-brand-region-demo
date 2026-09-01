// SHARED LOGIN-ALIAS RESOLUTION (pure, framework-free, unit-tested)
// ==================================================================
// Model 2 lets a customer add VERIFIED alternate sign-in emails that all resolve
// to the SAME primary sbd-eu database credential and shared password — NO second
// password store, NO second identity of their own. A verified alternate is a
// linked passwordless `email` identity (so it carries no password) whose address
// is NOT the account's root email, which is why a password sign-in typed with
// the alternate must be RESOLVED to the account's primary login email before the
// tenant verifies the one shared password against it.
//
// This module is the PURE decision: given the typed email, the resolved SHARED
// connection name, and the minimal per-account facts the server gathered from
// Auth0, it returns which primary email to retry with — or fails CLOSED. It has
// NO IO and NO framework imports so it is exhaustively unit-testable, mirroring
// lib/credential-model.ts and lib/google-reconcile.ts.
//
// CONNECTION CORRECTNESS: the caller MUST pass the SAME shared connection name
// the rest of the credential architecture uses (resolveConnectionNames().shared),
// never a divergent per-deployment constant. An account only counts as a shared
// alias match when it ACTUALLY holds a database identity on THAT connection, so a
// stray alias can never fabricate a match and a connection-name mismatch can
// never silently drop a legitimate alias.

import { normalizeEmail } from "./credential-model.ts"

/** Minimal, non-secret facts about one candidate Auth0 account. */
export interface LoginAliasCandidate {
  /** Auth0 `user_id` — the account identity, used only to de-dupe/ownership. */
  userId: string
  /** The account's root email (its primary login identifier). */
  rootEmail: string
  /** Whether the root email is verified. */
  rootEmailVerified: boolean
  /** Database identity connection names on this record (provider "auth0"). */
  sharedIdentityConnections: string[]
  /** Persisted, already-verified alternate emails
   *  (app_metadata.login_alias_emails — only ever written AFTER verification). */
  aliasEmails: string[]
}

/**
 * The outcome of resolving a typed email to a shared primary login identifier:
 *   • "resolved"      → retry the shared password against `primaryEmail`.
 *   • "same-as-typed" → the typed address already IS the matched account's root
 *                       email, so attempt 1 covered it (a genuine wrong password);
 *                       no retry.
 *   • "none"          → the typed address is not a verified alias/root of any
 *                       shared-backed account here → fail closed (no retry).
 *   • "ambiguous"     → more than one distinct account claims it → fail closed.
 */
export type SharedLoginAliasResolution =
  | { kind: "resolved"; primaryEmail: string }
  | { kind: "same-as-typed" }
  | { kind: "none" }
  | { kind: "ambiguous" }

export interface PlanSharedLoginAliasParams {
  typedEmail: string
  /** resolveConnectionNames().shared — the authoritative shared connection. */
  sharedConnectionName: string | undefined
  candidates: LoginAliasCandidate[]
}

/**
 * Resolve a submitted email to the ONE shared primary login email to retry the
 * shared password against, failing CLOSED on anything unproven or ambiguous.
 *
 * A candidate counts ONLY when it BOTH (a) genuinely holds a database identity
 * on the resolved shared connection AND (b) the typed email is one of its
 * persisted verified aliases, or its own VERIFIED root email. Unverified roots,
 * unbound addresses, and aliases on an account with no shared identity are all
 * rejected; two or more distinct owning accounts are ambiguous.
 */
export function planSharedLoginAlias(
  params: PlanSharedLoginAliasParams,
): SharedLoginAliasResolution {
  const typed = normalizeEmail(params.typedEmail)
  const shared = params.sharedConnectionName?.trim()
  // No typed address, or no configured shared connection to authenticate
  // against → nothing can be a shared alias. Fail closed.
  if (!typed || !shared) return { kind: "none" }

  const owners = new Map<string, { primaryEmail: string; isRoot: boolean }>()
  for (const c of params.candidates) {
    if (!c.userId) continue
    // (a) The account must ACTUALLY hold a shared-connection database identity.
    const hasShared = c.sharedIdentityConnections.some((n) => n === shared)
    if (!hasShared) continue

    const root = normalizeEmail(c.rootEmail)
    if (!root) continue
    const aliases = c.aliasEmails.map((e) => normalizeEmail(e))
    // (b) The typed address is a persisted verified alias, or the VERIFIED root.
    const isAlias = aliases.includes(typed)
    const isVerifiedRoot = root === typed && c.rootEmailVerified === true
    if (!isAlias && !isVerifiedRoot) continue

    owners.set(c.userId, { primaryEmail: root, isRoot: root === typed })
  }

  if (owners.size === 0) return { kind: "none" }
  if (owners.size > 1) return { kind: "ambiguous" }

  const [only] = [...owners.values()]
  // Typed address IS the account's root: attempt 1 already tried this username
  // against the shared realm, so a retry is pointless (genuine wrong password).
  if (only.isRoot) return { kind: "same-as-typed" }
  return { kind: "resolved", primaryEmail: only.primaryEmail }
}
