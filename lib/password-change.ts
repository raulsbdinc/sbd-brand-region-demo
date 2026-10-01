// PURE PASSWORD-CHANGE TARGET PLANNER
// ===================================
// In-site (signed-in) password CHANGE — resolves EXACTLY which database
// credential the customer may change, from trusted server-side facts only.
// Framework-free so every allow-list / fail-closed rule is unit-testable.
//
// The browser never supplies a connection name, connection id, or Auth0 user
// id. It supplies at most a target SELECTOR:
//   • { scope: "shared" }            → the account's ONE shared credential.
//   • { bindingId: "<id>" }          → a specific per-email / per-brand binding.
// The planner derives the real coordinates (connectionKey + email + the Auth0
// database identity user_id to PATCH) from the signed-in account's own bindings
// and linked identities, then hands them back to the server bridge which
// translates the key to a connection name/id.
//
// FAIL CLOSED on anything that is not a single, owned, backed, configured,
// allow-listed DATABASE (password) target:
//   • a social identity is NEVER a change target (no password to change);
//   • an unowned / tampered / unknown binding id is refused;
//   • a shared target with no real shared database identity is refused;
//   • more than one shared database identity is ambiguous → refused.

import {
  CONNECTION_KEY_META,
  isConnectionKey,
  resolveResetBinding,
  type ConnectionKey,
  type CredentialBinding,
  type LinkedDbIdentity,
} from "./credential-model.ts"
import { validateRegistrationPassword } from "./password-policy.ts"
import {
  passwordCredentialLabel,
  type PasswordCredentialView,
} from "./password-credential-labels.ts"
import type { BrandId } from "./types.ts"

/** What the browser is allowed to ask for — a selector, never coordinates. */
export type PasswordChangeSelector =
  | { scope: "shared" }
  | { bindingId: string }

/** A resolved, allow-listed change target the server bridge can act on. */
export interface PasswordChangeTarget {
  connectionKey: ConnectionKey
  /**
   * The Auth0 database identity `user_id` used for OWNERSHIP matching against
   * bindings and linked identities. Provider-LESS (e.g. "6a97383c…"), exactly
   * as it appears in `credential_bindings.auth0UserId` and in the identities
   * array's `user_id`. This identifies WHICH database identity changes, but is
   * NOT the Management PATCH id — use `managementUserId` for any PATCH.
   */
  auth0UserId: string
  /**
   * The id for Auth0 Management `PATCH /users/{id}` — ALWAYS the PRIMARY/ROOT
   * account user id (e.g. "auth0|6a97383c…"), provider-qualified.
   *
   * A linked SECONDARY database identity (a case-3/4 credential merged into the
   * primary via account linking) does NOT exist as its own Management user: a
   * PATCH to the secondary's own `user_id` returns 404 `inexistent_user`. Auth0
   * requires updating the PRIMARY user and disambiguating the exact database
   * identity with the `connection` property in the body. So the route PATCHes
   * this root id with `{ password, connection }`; Auth0 targets the identity on
   * that connection. For a primary/root credential this id equals the matched
   * identity's own qualified id, so primary/shared behavior is unchanged.
   */
  managementUserId: string
  /**
   * True when the resolved target is a linked SECONDARY database identity (its
   * `user_id` differs from the account root), i.e. the PATCH relies on the
   * `connection` property to reach it under the primary user. Informational —
   * the route always sends `connection`, so both paths are handled uniformly.
   */
  isLinkedSecondary: boolean
  /** The email this credential authenticates with (verify + update key). */
  email: string
  /** Customer-facing credential label (e.g. "Account password"). */
  label: string
  /** Brand for a per-brand credential; undefined for shared / per-email. */
  brand?: BrandId
}

export type PasswordChangeResolution =
  | { ok: true; target: PasswordChangeTarget }
  | {
      ok: false
      reason:
        | "invalid-selector"
        | "no-shared-credential"
        | "ambiguous-shared"
        | "not-found"
        | "unbacked"
        | "not-configured"
        | "not-allowlisted"
        | "social-identity"
    }

export interface ResolvePasswordChangeParams {
  selector: PasswordChangeSelector
  /** Bindings on the SIGNED-IN primary account (already sanitized). */
  bindings: CredentialBinding[]
  /** The signed-in primary account's real linked DATABASE identities. */
  identities: LinkedDbIdentity[]
  /** Connection keys that have a configured connection name/id (server-only). */
  configuredKeys: ReadonlySet<ConnectionKey>
  /** The account's root email (the shared credential's login email). */
  rootEmail: string
  /**
   * The SIGNED-IN primary account's root Auth0 user id (`primaryUser.user_id`,
   * e.g. "auth0|6a97383c…"). This is the id every password change PATCHes: for a
   * linked SECONDARY identity Auth0 rejects a PATCH to the secondary's own id
   * (404 inexistent_user) and requires updating the primary user with the
   * `connection` property instead. Provider-qualified as Auth0 returns it.
   */
  rootUserId: string
}

function isSharedSelector(
  selector: PasswordChangeSelector,
): selector is { scope: "shared" } {
  return (
    typeof selector === "object" &&
    selector !== null &&
    "scope" in selector &&
    (selector as { scope?: unknown }).scope === "shared"
  )
}

function isBindingSelector(
  selector: PasswordChangeSelector,
): selector is { bindingId: string } {
  return (
    typeof selector === "object" &&
    selector !== null &&
    "bindingId" in selector &&
    typeof (selector as { bindingId?: unknown }).bindingId === "string"
  )
}

function labelFor(view: PasswordCredentialView): string {
  return passwordCredentialLabel(view)
}

/**
 * Provider-qualify a database identity `user_id` for the Auth0 Management API.
 *
 * The identities array and `credential_bindings.auth0UserId` store the id
 * WITHOUT the connection provider prefix (e.g. "6a97383c…"), but Management
 * `PATCH /users/{id}` requires the qualified form "auth0|6a97383c…". Every
 * password change target is a DATABASE identity, whose provider is always
 * `auth0`, so we qualify with that. Defensive: an id that already carries a
 * `provider|` prefix is returned unchanged (never double-prefixed), and a blank
 * id is returned as-is for the caller's own fail-closed handling.
 */
export function toManagementUserId(userId: string): string {
  const trimmed = (userId ?? "").trim()
  if (!trimmed) return trimmed
  // Already provider-qualified (has a "provider|subject" shape) → leave as-is.
  if (trimmed.includes("|")) return trimmed
  return `auth0|${trimmed}`
}

/**
 * The provider-LESS subject of an Auth0 user id — the part after "provider|"
 * (e.g. "auth0|6a97…" → "6a97…"), or the value unchanged when it has no prefix.
 * Used to compare a matched database identity's `user_id` (stored provider-less
 * in bindings/identities) against the account root sub (provider-qualified) to
 * decide whether the target is the root identity or a linked secondary.
 */
export function bareUserId(userId: string): string {
  const trimmed = (userId ?? "").trim()
  const pipe = trimmed.indexOf("|")
  return pipe >= 0 ? trimmed.slice(pipe + 1) : trimmed
}

/**
 * Resolve the single database credential the signed-in customer may change.
 *
 * SHARED selector → require exactly one real shared-connection database
 * identity on the account (the credential that Models 1 & 2 sign in with) and
 * return it. Zero → "no-shared-credential"; more than one → "ambiguous-shared".
 * The shared login email is the account root email.
 *
 * BINDING selector → delegate to resolveResetBinding, which already enforces
 * ownership (the id is on THIS account), allow-listing, configuration, and that
 * the binding is backed by a real linked identity on this same account. The
 * resolved binding carries the exact connectionKey, email, and auth0UserId.
 *
 * A social identity can never be reached: the shared path only accepts
 * `provider: auth0` database identities (LinkedDbIdentity is already filtered to
 * auth0 by the server bridge), and the binding path requires a DATABASE binding
 * backed by a database identity. There is deliberately no selector that names a
 * social identity.
 */
export function resolvePasswordChangeTarget(
  params: ResolvePasswordChangeParams,
): PasswordChangeResolution {
  const { selector, bindings, identities, configuredKeys, rootEmail, rootUserId } =
    params
  // The PATCH id is ALWAYS the primary/root account user, provider-qualified.
  const managementUserId = toManagementUserId(rootUserId)
  const rootBare = bareUserId(rootUserId)

  if (isSharedSelector(selector)) {
    // The shared credential must have a configured connection to be changeable.
    if (!configuredKeys.has("shared")) {
      return { ok: false, reason: "not-configured" }
    }
    // Find the account's real shared-connection database identities. Exactly one
    // is the normal Model 1/2 shape; zero means this account has no shared
    // password (a case-3/4-only account) and must use a binding selector.
    const sharedIdentities = identities.filter(
      (i) => i.connectionKey === "shared" && Boolean(i.userId),
    )
    if (sharedIdentities.length === 0) {
      return { ok: false, reason: "no-shared-credential" }
    }
    if (sharedIdentities.length > 1) {
      return { ok: false, reason: "ambiguous-shared" }
    }
    const email = rootEmail.trim().toLowerCase()
    if (!email) return { ok: false, reason: "no-shared-credential" }
    return {
      ok: true,
      target: {
        connectionKey: "shared",
        auth0UserId: sharedIdentities[0].userId,
        managementUserId,
        isLinkedSecondary:
          bareUserId(sharedIdentities[0].userId) !== rootBare,
        email,
        label: labelFor({ connectionKey: "shared" }),
      },
    }
  }

  if (isBindingSelector(selector)) {
    const resolution = resolveResetBinding({
      bindingId: selector.bindingId,
      bindings,
      identities,
      configuredKeys,
    })
    if (!resolution.ok) {
      // Map the binding resolver's reasons onto ours 1:1 (all fail closed).
      return { ok: false, reason: resolution.reason }
    }
    const { binding } = resolution
    // Defensive: resolveResetBinding already allow-lists, but never trust a key.
    if (!isConnectionKey(binding.connectionKey)) {
      return { ok: false, reason: "not-allowlisted" }
    }
    const brand =
      binding.connectionKey === "dewalt" || binding.connectionKey === "stanley"
        ? (binding.connectionKey as BrandId)
        : binding.brand
    return {
      ok: true,
      target: {
        connectionKey: binding.connectionKey,
        auth0UserId: binding.auth0UserId,
        managementUserId,
        isLinkedSecondary: bareUserId(binding.auth0UserId) !== rootBare,
        email: binding.email,
        label: labelFor({
          connectionKey: binding.connectionKey,
          brand,
          email: binding.email,
        }),
        brand,
      },
    }
  }

  return { ok: false, reason: "invalid-selector" }
}

// --- Pure UPDATE-EXECUTION planner ------------------------------------------
// Resolving WHICH credential to change (above) is separate from HOW to apply
// the change through the Management API. The "how" carries a correctness
// constraint proven by a live defect:
//
//   Auth0 `PATCH /users/{primaryId}` with `{ password, connection }` scopes the
//   write by CONNECTION NAME. That is only unambiguous when the account has
//   EXACTLY ONE identity on that connection. In the per-email model TWO verified
//   emails (A and B) are linked as separate database identities on the SAME
//   connection, so a connection-scoped PATCH updates whichever identity Auth0
//   matches first (in practice the primary/first), NOT the selected email. The
//   observed result: the selected email's password never changes (its old
//   password still authenticates) while another identity's password is silently
//   overwritten — corrupting A+P_A.
//
// Therefore a LINKED SECONDARY database identity must be changed by targeting
// its EXACT database user_id. Auth0 has no endpoint to PATCH a specific linked
// secondary directly (a PATCH to its own id returns 404 inexistent_user, and a
// connection-scoped PATCH is ambiguous), so the only precise path is to
// temporarily UNLINK it (restoring it as a standalone Management user), PATCH
// that user, then RELINK it. A ROOT/primary identity (shared Models 1-2, or a
// standalone per-email/brand account whose sole identity IS the root) is
// unambiguous and uses a direct connection-scoped PATCH, unchanged.

/** Direct PATCH on the root/primary user — used only for an unambiguous root identity. */
export interface DirectPasswordUpdatePlan {
  mode: "direct"
  /** Provider-qualified id to PATCH (the root/primary account user). */
  patchUserId: string
  /** Connection name sent in the PATCH body to scope the password write. */
  connectionName: string
}

/** Unlink → PATCH the standalone secondary → relink — targets the EXACT identity. */
export interface RelinkPasswordUpdatePlan {
  mode: "relink"
  /** The primary/root account user the secondary is currently linked under. */
  primaryUserId: string
  /** Provider of the secondary database identity (always "auth0" for a password). */
  provider: "auth0"
  /** Provider-LESS secondary user_id — the unlink path segment + relink `user_id`. */
  secondaryUserId: string
  /** Provider-qualified secondary id to PATCH once it is standalone again. */
  secondaryPatchUserId: string
  /** Connection name sent in the PATCH body. */
  connectionName: string
  /** Connection id for the by-reference relink (when configured). */
  connectionId?: string
}

export type PasswordUpdatePlan =
  | DirectPasswordUpdatePlan
  | RelinkPasswordUpdatePlan

export interface PlanPasswordUpdateInput {
  /** Provider-LESS matched database identity id (from the resolved target). */
  auth0UserId: string
  /** Provider-qualified root/primary account user id. */
  managementUserId: string
  /** True when the matched identity is a linked secondary (not the account root). */
  isLinkedSecondary: boolean
  /** Resolved connection name for the target key. */
  connectionName: string
  /** Resolved connection id for the target key (for the relink). */
  connectionId?: string
}

/**
 * Decide HOW to apply a verified password change so it hits EXACTLY the resolved
 * database identity and nothing else. Pure + unit-tested; the route executes the
 * returned plan (with rollback for the relink path).
 *
 * A linked secondary ALWAYS uses the relink path — even on a connection that
 * currently holds a single identity — so the write can never be mis-scoped by
 * connection matching (the per-email model puts two identities on one
 * connection). Only the account's own root identity uses the direct PATCH.
 */
export function planPasswordUpdate(
  input: PlanPasswordUpdateInput,
): PasswordUpdatePlan {
  if (input.isLinkedSecondary) {
    return {
      mode: "relink",
      primaryUserId: input.managementUserId,
      provider: "auth0",
      secondaryUserId: bareUserId(input.auth0UserId),
      secondaryPatchUserId: toManagementUserId(input.auth0UserId),
      connectionName: input.connectionName,
      connectionId: input.connectionId,
    }
  }
  return {
    mode: "direct",
    patchUserId: input.managementUserId,
    connectionName: input.connectionName,
  }
}

// --- New-password policy (pure, client + server share it) -------------------
// A minimal, honest local policy that mirrors Auth0's common "good" policy
// (≥8 chars, at least one lower, one upper, and one number). The tenant remains
// the authority — a create/update still fails closed on the server if Auth0's
// configured policy is stricter — but validating locally lets us disable submit
// and show inline guidance without a noisy round-trip.

export const PASSWORD_MIN_LENGTH = 8

export interface PasswordPolicyResult {
  ok: boolean
  failures: string[]
}

/**
 * Validate a candidate new password. EU/FR/DE (default): the baseline below.
 * UK: the UK connection policy (15 characters, 3 of 4 classes, no email
 * fragment) from lib/password-policy, so resets and profile changes match
 * signup and Auth0.
 */
export function validateNewPassword(
  password: string,
  market?: string,
  emails: string[] = [],
): PasswordPolicyResult {
  if (market === "uk") return validateRegistrationPassword(password, emails, "uk")
  // FR/DE: exactly the sbd-emea-temp1 connection policy (CIAM-16).
  if (market === "fr" || market === "de") return validateRegistrationPassword(password, emails, market)
  const failures: string[] = []
  if (password.length < PASSWORD_MIN_LENGTH) {
    failures.push(`At least ${PASSWORD_MIN_LENGTH} characters`)
  }
  if (!/[a-z]/.test(password)) failures.push("A lowercase letter")
  if (!/[A-Z]/.test(password)) failures.push("An uppercase letter")
  if (!/[0-9]/.test(password)) failures.push("A number")
  return { ok: failures.length === 0, failures }
}

/**
 * Whether a change form is submittable, given the three fields. Pure so the UI
 * and its tests agree exactly on the enable rule:
 *   • current password present,
 *   • new password meets policy,
 *   • confirm equals new,
 *   • new differs from current.
 */
export function canSubmitPasswordChange(input: {
  current: string
  next: string
  confirm: string
  market?: string
  emails?: string[]
}): boolean {
  if (!input.current) return false
  if (!validateNewPassword(input.next, input.market, input.emails ?? []).ok) return false
  if (input.next !== input.confirm) return false
  if (input.next === input.current) return false
  return true
}

// --- Auth0 error mapping (pure) ---------------------------------------------

/**
 * Map an Auth0 password-update failure to a neutral, customer-facing message.
 * Policy failures (Auth0 codes / messages that mention strength, history, or
 * dictionary) become a helpful hint; everything else collapses to a generic
 * failure so we never leak upstream specifics. Never includes the password.
 */
export function mapPasswordUpdateError(input: {
  status?: number
  code?: string
  message?: string
}): string {
  const haystack = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase()
  const policySignals = [
    "passwordstrengtherror",
    "password is too weak",
    "password is too common",
    "passwordnohistoryerror",
    "password has previously been used",
    "passworddictionaryerror",
    "pwd_strength",
    "too weak",
    "strength",
    "dictionary",
    "previously been used",
  ]
  if (input.status === 400 && policySignals.some((s) => haystack.includes(s))) {
    return "That new password doesn't meet the password policy. Choose a stronger one you haven't used before."
  }
  return "We couldn't change your password. Please try again."
}

/** Meta helper: the customer label for a connection key (for server responses). */
export function connectionKeyLabel(key: ConnectionKey): string {
  return CONNECTION_KEY_META[key].label
}
