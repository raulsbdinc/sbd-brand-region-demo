// CREDENTIAL PROVISIONING MODEL — PURE, ALLOW-LISTED INTENTS
// =========================================================
// Decides, from a customer-safe INTENT and the signed-in account's already
// proven state, exactly which allow-listed connection a NEW password credential
// must be created on, which email it signs in with, and the coherent
// CredentialBinding to persist. It is deliberately FRAMEWORK-FREE (no
// "server-only") so every rule is unit-testable without Auth0.
//
// The browser may only ever submit an allow-listed intent + (when needed) a
// selected email + the password. It NEVER submits a connection name/id, user id,
// use case, or brand. Those are resolved HERE from SITE_BRAND and the account's
// server-proven verified emails / existing bindings — never from the request.
//
//   • "another-email" → the per-email connection, for an alternate verified
//                       email that does not already have its own password.
//   • "this-brand"    → the current SITE_BRAND's brand connection (DeWalt or
//                       Stanley only), for the account's verified primary email.
//
// Every rule fails CLOSED with a neutral reason: unknown/unverified email,
// duplicate credential, a credential that would make sign-in unresolvable
// (a collision on the target sites), an unconfigured connection, or an
// unsupported brand.

import {
  isConnectionKey,
  normalizeEmail,
  sanitizeCredentialBinding,
  type ConnectionKey,
  type CredentialBinding,
  type DemoUseCase,
} from "./credential-model.ts"
import type { BrandId } from "./types"

/** The only outcomes the browser may request. */
export type ProvisionIntent = "another-email" | "this-brand"

const PROVISION_INTENTS: ReadonlySet<ProvisionIntent> = new Set<ProvisionIntent>([
  "another-email",
  "this-brand",
])

export function isProvisionIntent(value: unknown): value is ProvisionIntent {
  return typeof value === "string" && PROVISION_INTENTS.has(value as ProvisionIntent)
}

/** The brand connection key for a storefront brand, or null if the brand has none. */
export function brandConnectionKey(brand: BrandId): Extract<ConnectionKey, "dewalt" | "stanley"> | null {
  if (brand === "dewalt") return "dewalt"
  if (brand === "stanley") return "stanley"
  return null
}

/**
 * The server-PROVEN state the provisioning decision is made against. The route
 * builds this ONLY after re-reading the primary Auth0 user; the pure model
 * trusts these fields as already validated (ownership + verification), so it
 * never infers ownership from a matching email.
 */
export interface ProvisioningContext {
  siteBrand: BrandId
  /** Verified, owned emails on the primary account (normalized). Proven server-side. */
  verifiedEmails: string[]
  /** The account's primary/root email (normalized), used by "this-brand". */
  primaryEmail: string
  /** Existing coherent bindings on the primary account. */
  existingBindings: CredentialBinding[]
  /** Connection keys that have a configured connection name. */
  configuredKeys: ReadonlySet<ConnectionKey>
}

export type ProvisionRejectReason =
  | "invalid-intent"
  | "email-not-eligible" // not provided, or not a verified owned email
  | "duplicate-credential" // that exact target credential already exists
  | "conflicting-credential" // would create an unresolvable sign-in collision
  | "unsupported-brand" // "this-brand" on a site with no brand connection
  | "not-configured" // the target connection is not configured

export type ProvisionResolution =
  | {
      ok: true
      connectionKey: ConnectionKey
      email: string
      useCase: DemoUseCase
      brand?: BrandId
    }
  | { ok: false; reason: ProvisionRejectReason }

/** Scoped (non-shared) bindings for a given email, by connection key. */
function scopedBindingsForEmail(
  bindings: CredentialBinding[],
  email: string,
): CredentialBinding[] {
  return bindings.filter(
    (b) => b.connectionKey !== "shared" && normalizeEmail(b.email) === email,
  )
}

/**
 * Resolve an allow-listed provisioning intent into the concrete, coherent target
 * (connection key + email + use case + brand) for a NEW credential, or a neutral
 * rejection. Never trusts a connection name/id/user id — only the intent and the
 * server-proven context.
 *
 * Collision rules keep the produced credential IMMEDIATELY routable (so ordinary
 * Model 1/2 accounts can use it right away):
 *   • per-email matches on EVERY site, so an email may hold at most ONE scoped
 *     credential total — reject if it already has any.
 *   • a brand credential matches only on its brand's sites, so reject only when
 *     the email already has that same brand credential (duplicate) or a per-email
 *     credential (which would also match there → collision).
 */
export function resolveProvisioning(
  intent: unknown,
  selectedEmail: unknown,
  context: ProvisioningContext,
): ProvisionResolution {
  if (!isProvisionIntent(intent)) return { ok: false, reason: "invalid-intent" }

  const verified = new Set(context.verifiedEmails.map(normalizeEmail).filter(Boolean))

  if (intent === "another-email") {
    const email = normalizeEmail(selectedEmail)
    if (!email || !verified.has(email)) return { ok: false, reason: "email-not-eligible" }
    // "Another email" is specifically for an ALTERNATE verified email — never
    // the account's primary/root address (that address's password is governed by
    // the account / this-brand options). Reject the primary here so a client
    // cannot submit it under this intent even though it is a verified email.
    if (email === normalizeEmail(context.primaryEmail)) {
      return { ok: false, reason: "email-not-eligible" }
    }
    if (!context.configuredKeys.has("per-email")) return { ok: false, reason: "not-configured" }

    const scoped = scopedBindingsForEmail(context.existingBindings, email)
    if (scoped.some((b) => b.connectionKey === "per-email")) {
      return { ok: false, reason: "duplicate-credential" }
    }
    // Any other scoped credential (a brand password) for this email would also
    // match on that brand's sites alongside the new per-email one → collision.
    if (scoped.length > 0) return { ok: false, reason: "conflicting-credential" }

    return { ok: true, connectionKey: "per-email", email, useCase: "per-email-password" }
  }

  // intent === "this-brand"
  const key = brandConnectionKey(context.siteBrand)
  if (!key) return { ok: false, reason: "unsupported-brand" }

  const email = normalizeEmail(context.primaryEmail)
  if (!email || !verified.has(email)) return { ok: false, reason: "email-not-eligible" }
  if (!context.configuredKeys.has(key)) return { ok: false, reason: "not-configured" }

  const scoped = scopedBindingsForEmail(context.existingBindings, email)
  if (scoped.some((b) => b.connectionKey === key)) {
    return { ok: false, reason: "duplicate-credential" }
  }
  // A per-email credential for this email would also match on this brand's site
  // alongside the new brand credential → collision.
  if (scoped.some((b) => b.connectionKey === "per-email")) {
    return { ok: false, reason: "conflicting-credential" }
  }

  return {
    ok: true,
    connectionKey: key,
    email,
    useCase: "per-brand-password",
    brand: context.siteBrand,
  }
}

/**
 * Build the coherent CredentialBinding to persist for a freshly created +
 * linked identity. Reuses {@link sanitizeCredentialBinding} so an incoherent
 * combination can never be written. Throws only on a programming error (an
 * incoherent target that should have been rejected upstream).
 */
export function buildCredentialBinding(params: {
  connectionKey: ConnectionKey
  email: string
  useCase: DemoUseCase
  auth0UserId: string
  brand?: BrandId
}): CredentialBinding {
  if (!isConnectionKey(params.connectionKey)) {
    throw new Error("buildCredentialBinding: non-allow-listed connection key")
  }
  const binding = sanitizeCredentialBinding({
    id: `${params.connectionKey}:${params.auth0UserId}`,
    email: params.email,
    connectionKey: params.connectionKey,
    auth0UserId: params.auth0UserId,
    useCase: params.useCase,
    brand: params.brand,
  })
  if (!binding) throw new Error("buildCredentialBinding: incoherent binding")
  return binding
}

/**
 * Append a new binding to the existing set, PRESERVING all existing bindings and
 * refusing to introduce a duplicate (by connection key + auth0 user id). Returns
 * a new array; never mutates the input.
 */
export function appendCredentialBinding(
  existing: CredentialBinding[],
  added: CredentialBinding,
): CredentialBinding[] {
  const dedupe = (b: CredentialBinding) => `${b.connectionKey}|${b.auth0UserId}`
  const key = dedupe(added)
  if (existing.some((b) => dedupe(b) === key)) return [...existing]
  return [...existing, added]
}

/** What the /profile "Add password" dialog needs to render its two outcomes. */
export interface AddPasswordAvailability {
  anotherEmail: {
    /** Verified emails that can still receive their own password. */
    eligibleEmails: string[]
    available: boolean
  }
  thisBrand: {
    available: boolean
    brand?: BrandId
    email?: string
    reason?: ProvisionRejectReason
  }
}

/**
 * Compute what the "Add password" flow may offer for this account, WITHOUT any
 * customer-facing internal vocabulary. The route exposes this to the browser so
 * the dialog only ever presents genuinely valid options.
 */
export function computeAddPasswordAvailability(
  context: ProvisioningContext,
): AddPasswordAvailability {
  const primary = normalizeEmail(context.primaryEmail)
  const verified = context.verifiedEmails.map(normalizeEmail).filter(Boolean)
  const eligibleEmails = verified.filter(
    (email) =>
      // Exclude the primary/root email — "Another email" is for an ALTERNATE
      // verified address only (kept in lockstep with resolveProvisioning).
      email !== primary &&
      scopedBindingsForEmail(context.existingBindings, email).length === 0,
  )

  const brandResolution = resolveProvisioning("this-brand", null, context)

  return {
    anotherEmail: {
      eligibleEmails,
      available:
        context.configuredKeys.has("per-email") && eligibleEmails.length > 0,
    },
    thisBrand: brandResolution.ok
      ? { available: true, brand: brandResolution.brand, email: brandResolution.email }
      : { available: false, reason: brandResolution.reason },
  }
}
