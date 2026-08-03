// RIGHT-TO-BE-FORGOTTEN ERASURE MODEL
// ===================================
// Deleting a user's Auth0 / Okta identity is only the FIRST hop of a real
// "right to be forgotten" (RTBF) request. SBD holds personal data in several
// downstream systems (order history, warranty registrations, marketing/consent,
// support tickets, analytics). This POC records intended targets but does not
// verify that those systems completed deletion or anonymization.
//
// This module is the single, framework-free source of truth for:
//   1. WHICH downstream systems hold personal data (the erasure registry).
//   2. WHAT the region-aware erasure PLAN looks like for a given tenant.
//   3. The RECEIPT shape we record + return so the request is auditable.
//   4. The RETENTION / SLA constants that govern timing.
//
// It is intentionally pure (no `server-only`, no secrets, no fetch) so the API
// routes, the account UI, and the /architecture page can all import the same
// definitions and never drift. The actual best-effort webhook dispatch lives in
// the delete route, which is the only place that touches env + network.
//
// This models Auth0 best practice: the Management API `DELETE /users/{id}`
// erases the identity, and a downstream cascade (webhook / deletion API) fans
// the request out to every other system that stored the person's data. See
// FEATURE_BACKLOG.md Part 3.10.

import {
  DEFAULT_AUTH_REGION,
  HOSTING_REGIONS,
  tenantById,
  type HostingRegionId,
} from "./regions"

// ---------------------------------------------------------------------------
// Erasure modes
// ---------------------------------------------------------------------------

/**
 * SOFT = reversible (block the identity + flag it, admin can restore) — the
 * default so the shared demo tenant is never destructively wiped.
 * HARD = irreversible Management API `DELETE /users/{id}` (opt-in via
 * `AUTH0_ALLOW_HARD_DELETE=1`).
 */
export type ErasureMode = "soft" | "hard"

// ---------------------------------------------------------------------------
// Downstream systems registry
// ---------------------------------------------------------------------------

export type DownstreamCategory =
  | "identity"
  | "commerce"
  | "marketing"
  | "support"
  | "analytics"
  | "product"

/** How a system honours an erasure request. */
export type ErasureAction = "delete" | "anonymize" | "retain-legal"

export interface DownstreamSystem {
  id: string
  /** Human name shown in the UI / receipt. */
  name: string
  category: DownstreamCategory
  /** What personal data this system stores. */
  holds: string
  /** How this system actions the request. */
  action: ErasureAction
  /** Plain-English note on the behaviour (incl. any legal retention). */
  note: string
}

/**
 * The systems an SBD RTBF request must reach. The identity directory is the
 * anchor (Auth0 / Okta); everything else is a downstream consumer of that
 * identity. Representative for the showcase — the real list is confirmed with
 * each system owner and Legal. The entries are a proposal, not a verified
 * production inventory or tested cascade.
 */
export const DOWNSTREAM_SYSTEMS: DownstreamSystem[] = [
  {
    id: "auth0-directory",
    name: "Identity directory (Auth0 / Okta)",
    category: "identity",
    holds: "Profile, email, credentials, MFA factors, passkeys, connected logins",
    action: "delete",
    note: "The identity itself. Soft delete blocks + flags it (reversible); hard delete calls Management API DELETE /users/{id} (irreversible).",
  },
  {
    id: "order-management",
    name: "Order management (OM / Polaris)",
    category: "commerce",
    holds: "Order history, shipping and billing addresses, contact details",
    action: "anonymize",
    note: "Transaction records are retained for tax and accounting law, but personal identifiers are anonymized so the orders can no longer be tied to the person.",
  },
  {
    id: "warranty-registry",
    name: "Warranty & product registration",
    category: "commerce",
    holds: "Registered products, serial numbers, proof-of-purchase, owner contact",
    action: "retain-legal",
    note: "An active warranty is a legal obligation, so the record is kept until the warranty expires; owner contact details are then erased on the retention schedule.",
  },
  {
    id: "marketing-consent",
    name: "Marketing & consent platform",
    category: "marketing",
    holds: "Email/SMS subscriptions, consent state, campaign engagement",
    action: "delete",
    note: "Fully deleted, and the email is added to a hashed suppression list so no future marketing is sent (no PII retained — only a one-way hash).",
  },
  {
    id: "support-tickets",
    name: "Support tickets (Zendesk)",
    category: "support",
    holds: "Support conversations, attachments, requester contact details",
    action: "anonymize",
    note: "Ticket content is kept for quality and audit, but the requester is anonymized so it can no longer be linked back to the person.",
  },
  {
    id: "analytics-warehouse",
    name: "Analytics warehouse (Treasure Data)",
    category: "analytics",
    holds: "Behavioural events, device and session identifiers",
    action: "anonymize",
    note: "Identifiers are de-identified so aggregate analytics survive without any link to the individual.",
  },
  {
    id: "product-id",
    name: "Product ID service data",
    category: "product",
    holds: "Scan history, saved products, registrations tied to the account",
    action: "delete",
    note: "Account-linked scan and registration data is deleted outright.",
  },
]

/** Look up a downstream system by id. */
export function downstreamSystemById(id: string): DownstreamSystem | undefined {
  return DOWNSTREAM_SYSTEMS.find((s) => s.id === id)
}

// ---------------------------------------------------------------------------
// Retention & SLA
// ---------------------------------------------------------------------------

/**
 * Reversible grace window for a SOFT delete: the account is blocked immediately
 * but an admin can restore it for this many days before the erasure is finalized.
 */
export const ERASURE_GRACE_PERIOD_DAYS = 30

/**
 * Hard SLA to complete the cascade across all systems. Aligns with the GDPR
 * "without undue delay and in any event within one month" expectation.
 */
export const ERASURE_SLA_DAYS = 30

// ---------------------------------------------------------------------------
// Erasure plan (region-aware)
// ---------------------------------------------------------------------------

export type ErasureStepStatus = "pending" | "dispatched" | "done" | "skipped"

export interface ErasureStep {
  systemId: string
  name: string
  category: DownstreamCategory
  action: ErasureAction
  note: string
  status: ErasureStepStatus
}

export interface ErasurePlan {
  /** The auth region id (americas | emea | apac | japan | china). */
  region: string
  /** The tenant display name that holds the identity. */
  tenant: string
  /** Where that tenant's data physically lives. */
  hosting: HostingRegionId
  hostingName: string
  /** True when the region is handled outside the standard footprint (China). */
  special: boolean
  /** One line explaining the residency implication for erasure. */
  residencyNote: string
  steps: ErasureStep[]
}

/**
 * Build the ordered erasure plan for a region. Every SBD RTBF request runs the
 * same downstream cascade; the region only changes WHERE the erasure happens
 * (data residency) — never WHETHER a system is included. Isolation between
 * tenants is why the erasure is scoped to the region that holds the identity:
 * the cascade fans out from the home tenant only, so it never reaches into
 * another region's data.
 */
export function buildErasurePlan(regionId?: string | null): ErasurePlan {
  const region = regionId || DEFAULT_AUTH_REGION
  const tenant = tenantById(region)
  const hosting = tenant?.hosting ?? "us"
  const hostingRegion = HOSTING_REGIONS[hosting]
  const special = Boolean(tenant?.special)

  const residencyNote = special
    ? "China is outside the proposed standard footprint. This POC does not verify an in-country erasure service."
    : `The receipt associates this request with the proposed ${tenant?.name ?? "home"} tenant and ${hostingRegion.name} hosting region. This POC does not verify where downstream processing occurs.`

  const steps: ErasureStep[] = DOWNSTREAM_SYSTEMS.map((s) => ({
    systemId: s.id,
    name: s.name,
    category: s.category,
    action: s.action,
    note: s.note,
    status: "pending",
  }))

  return {
    region,
    tenant: tenant?.name ?? "Home tenant",
    hosting,
    hostingName: hostingRegion.name,
    special,
    residencyNote,
    steps,
  }
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

export interface ErasureReceipt {
  /** Stable, shareable request id, e.g. "ers_ab12cd34". */
  requestId: string
  requestedAt: string
  mode: ErasureMode
  /** Where the request came from (e.g. "account-center"). */
  channel: string
  /** The identity subject (Auth0 `sub`). */
  subject: string
  region: string
  tenant: string
  hosting: HostingRegionId
  hostingName: string
  /** Whether the downstream cascade webhook was successfully dispatched. */
  webhookDispatched: boolean
  /** Per-system status snapshot at request time. */
  systems: Array<{
    systemId: string
    name: string
    action: ErasureAction
    status: ErasureStepStatus
  }>
  /** ISO date the cascade must be complete by (requestedAt + SLA). */
  completeBy: string
  /** ISO date the soft-delete grace window ends; null for hard deletes. */
  graceUntil: string | null
}

/** Mint a short, human-shareable erasure request id. */
export function newErasureRequestId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(16).slice(2, 10)
  return `ers_${rand}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

/**
 * Assemble a receipt for an erasure request. `dispatched` reflects whether the
 * downstream cascade fan-out was accepted; when true the downstream steps are
 * marked "dispatched", otherwise they stay "pending" (an operator/queue will
 * pick them up).
 */
export function buildErasureReceipt(input: {
  subject: string
  mode: ErasureMode
  channel: string
  region?: string | null
  webhookDispatched: boolean
}): ErasureReceipt {
  const requestedAt = new Date().toISOString()
  const plan = buildErasurePlan(input.region)
  const downstreamStatus: ErasureStepStatus = input.webhookDispatched
    ? "dispatched"
    : "pending"

  const systems = plan.steps.map((s) => ({
    systemId: s.systemId,
    name: s.name,
    action: s.action,
    // The identity directory is actioned inline by the delete route itself.
    status: s.systemId === "auth0-directory" ? ("done" as ErasureStepStatus) : downstreamStatus,
  }))

  return {
    requestId: newErasureRequestId(),
    requestedAt,
    mode: input.mode,
    channel: input.channel,
    subject: input.subject,
    region: plan.region,
    tenant: plan.tenant,
    hosting: plan.hosting,
    hostingName: plan.hostingName,
    webhookDispatched: input.webhookDispatched,
    systems,
    completeBy: addDays(requestedAt, ERASURE_SLA_DAYS),
    graceUntil: input.mode === "soft" ? addDays(requestedAt, ERASURE_GRACE_PERIOD_DAYS) : null,
  }
}

/** Friendly labels for erasure actions (UI + docs). */
export const ERASURE_ACTION_LABELS: Record<ErasureAction, string> = {
  delete: "Deleted",
  anonymize: "Anonymized",
  "retain-legal": "Retained (legal hold)",
}

/** Friendly labels for downstream categories. */
export const DOWNSTREAM_CATEGORY_LABELS: Record<DownstreamCategory, string> = {
  identity: "Identity",
  commerce: "Commerce",
  marketing: "Marketing",
  support: "Support",
  analytics: "Analytics",
  product: "Product",
}
