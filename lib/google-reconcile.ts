// PURE COLD-GOOGLE RECONCILE PLANNER (framework-free, unit-tested)
// ================================================================
// Decision core for the "cold Google login that collides with an existing
// account" journey. A cold Google sign-in (someone clicking "Continue with
// Google" while signed out) makes Auth0 mint a STANDALONE google-oauth2 user.
// If that Google account's VERIFIED email already belongs to another SBD
// account, we must NOT leave the duplicate in use — we route to a verification
// journey that proves ownership, links the Google identity onto the existing
// primary, and restores the primary session.
//
// This module decides WHAT to do from already-gathered facts. It performs no IO
// and imports nothing framework-specific, so every branch — especially the
// fail-closed ones — is unit-tested. The server route (lib is server-only there)
// gathers the session + directory facts and executes the returned decision.
//
// HARD RULES (all fail CLOSED):
//   • Never match on email alone — ownership MUST be proven before linking.
//   • Never link when the collision is ambiguous (more than one owner).
//   • Never link an already-linked / multi-identity Google record.
//   • Only ever act on a VERIFIED Google email.

/** The single standalone Google identity as read from the fresh session. */
export interface GoogleSessionFacts {
  /** Full session sub, e.g. "google-oauth2|1234". Empty when no session. */
  sub: string
  /** The Google account's own email. */
  email: unknown
  /** Whether Google asserts the email is verified. */
  emailVerified: boolean
  /** How many identities the current session user carries. */
  identityCount: number
  /** The provider of the sole identity (only meaningful when identityCount===1). */
  soleProvider: string | null
}

/**
 * The existing-account lookup outcome, mirroring
 * credential-resolver.resolveExistingAccountByEmail so the route can forward it
 * verbatim.
 */
export type ExistingAccountFacts =
  | { kind: "configured-off" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "single"; auth0UserId: string }

export interface ReconcileContext {
  managementConfigured: boolean
  google: GoogleSessionFacts
  /** Only consulted once the session is confirmed to be a lone Google record. */
  existing?: ExistingAccountFacts
}

export type ReconcileDecision =
  // Nothing to reconcile — leave the session as-is and land on /profile.
  | { action: "proceed"; reason: string }
  // A real collision with a DIFFERENT existing account: require proof, then link.
  | { action: "require-proof"; primaryUserId: string; email: string }
  // Fail closed: end the standalone Google session (and best-effort remove the
  // duplicate) and show a safe error. Never links.
  | { action: "fail-closed"; reason: ReconcileFailReason }

export type ReconcileFailReason = "ambiguous" | "lookup-unavailable"

function normalize(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

/** True only for a genuine, standalone, VERIFIED Google session record. */
export function isStandaloneVerifiedGoogle(g: GoogleSessionFacts): boolean {
  return (
    g.sub.startsWith("google-oauth2|") &&
    g.identityCount === 1 &&
    g.soleProvider === "google-oauth2" &&
    g.emailVerified === true &&
    normalize(g.email).length > 0
  )
}

/**
 * Decide how to reconcile a cold Google login. Pure: the caller supplies the
 * session facts and (when relevant) the existing-account lookup, and gets back
 * exactly one action. Order of checks is security-significant.
 */
export function planGoogleReconcile(ctx: ReconcileContext): ReconcileDecision {
  const { google } = ctx

  // No usable session, or not a cold standalone Google record → nothing to do.
  if (!google.sub) return { action: "proceed", reason: "no-session" }
  if (!google.sub.startsWith("google-oauth2|")) {
    return { action: "proceed", reason: "not-google" }
  }
  // Already linked / multi-identity → not a fresh duplicate; leave alone.
  if (google.identityCount !== 1 || google.soleProvider !== "google-oauth2") {
    return { action: "proceed", reason: "already-linked" }
  }
  // Unverified Google email → we may NEVER match it against an account.
  if (google.emailVerified !== true || normalize(google.email).length === 0) {
    return { action: "proceed", reason: "email-unverified" }
  }

  // Can't inspect the directory → can't prove a duplicate exists. Proceed as the
  // Google account rather than strand the user; there is nothing to link onto.
  if (!ctx.managementConfigured) {
    return { action: "proceed", reason: "management-off" }
  }

  const existing = ctx.existing ?? { kind: "configured-off" as const }
  switch (existing.kind) {
    case "configured-off":
      return { action: "proceed", reason: "management-off" }
    case "none":
      // The Google account is the only holder of this email — no duplicate.
      return { action: "proceed", reason: "no-existing-account" }
    case "unavailable":
      // A lookup failed: we cannot prove absence of a collision → fail closed.
      return { action: "fail-closed", reason: "lookup-unavailable" }
    case "ambiguous":
      // More than one account owns the email → never guess which to link.
      return { action: "fail-closed", reason: "ambiguous" }
    case "single": {
      // The lone owner IS this very Google record → already the account.
      if (existing.auth0UserId === google.sub) {
        return { action: "proceed", reason: "self" }
      }
      // A DIFFERENT existing account owns the email → prove, then link.
      return {
        action: "require-proof",
        primaryUserId: existing.auth0UserId,
        email: normalize(google.email),
      }
    }
  }
}
