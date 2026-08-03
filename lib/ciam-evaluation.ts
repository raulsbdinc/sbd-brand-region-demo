import {
  requirementEvidence,
  type OfficialSource,
  type SupportType,
} from "@/lib/ciam-evidence"

// CIAM evaluation model. Single source of truth for the /evaluation page and
// the short CIAM_EVALUATION.md doc.
//
// Based on the CIAM evaluation sheet (6 June 2026). Each requirement carries:
// - priority: the consumer requirement priority from the sheet.
// - inPoc: whether the CIAM team marked it for the proof of concept.
// - status: where THIS prototype stands, using the taxonomy below.
// - detail: plain-language reason for the status.
//
// Status taxonomy (the point of this page):
// - built:       Implemented in this repository with a usable POC path.
// - validated:   Feature exercised. This repository exercised the relevant
//                Auth0 path without adding a custom implementation.
// - in-progress: Partly connected. A required implementation or configuration
//                step is still missing.
// - simulated:   A labeled demo stands in for the provider or production system.
// - planned:     Production work. A known configuration, integration, governance,
//                or assurance task that this repository does not complete.
// - unknown:     Not exercised in this tenant or prototype; vendor documentation
//                may describe the capability, but that is not implementation proof.

export type EvalStatus =
  | "built"
  | "validated"
  | "in-progress"
  | "simulated"
  | "planned"
  | "unknown"

export type Priority = "Must Have" | "Nice to Have" | "TBD" | "N/A"

export type PocScope = "Yes" | "Yes (confirmed)" | "No" | "TBD" | "tbc" | "n/a"

export interface EvalRequirement {
  requirement: string
  priority: Priority
  inPoc: PocScope
  status: EvalStatus
  detail: string
  support: SupportType
  responsibility: string
  sources: OfficialSource[]
  prerequisite?: string
}

type BaseEvalRequirement = Omit<
  EvalRequirement,
  "support" | "responsibility" | "sources" | "prerequisite"
>

export interface EvalCategory {
  id: string
  title: string
  requirements: EvalRequirement[]
}

interface BaseEvalCategory {
  id: string
  title: string
  requirements: BaseEvalRequirement[]
}

export interface EvalStatusMeta {
  label: string
  short: string
  description: string
  // Tailwind classes for the status chip. Named colors are used here on
  // purpose: these are functional data indicators, like a chart legend.
  dot: string
  chip: string
}

export const EVAL_STATUS_ORDER: EvalStatus[] = [
  "built",
  "validated",
  "in-progress",
  "simulated",
  "planned",
  "unknown",
]

export const EVAL_STATUS_META: Record<EvalStatus, EvalStatusMeta> = {
  built: {
    label: "Built in POC",
    short: "Built",
    description:
      "Implemented in this repository with a usable POC path. Production readiness is assessed separately.",
    dot: "bg-emerald-500",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  validated: {
    label: "Feature exercised",
    short: "Exercised",
    description:
      "This repository exercised the relevant Auth0 path without adding a custom implementation. The result is POC evidence, not production certification.",
    dot: "bg-teal-500",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  "in-progress": {
    label: "Partly connected",
    short: "Partly connected",
    description: "A POC path exists, but required implementation or configuration is still missing.",
    dot: "bg-blue-500",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  simulated: {
    label: "Demo only",
    short: "Demo only",
    description: "A labeled demo stands in for the provider, data source, or production integration.",
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  planned: {
    label: "Production work",
    short: "Production work",
    description: "A known production configuration, integration, governance, or assurance task that this repository does not complete.",
    dot: "bg-slate-400",
    chip: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  },
  unknown: {
    label: "Not exercised",
    short: "Not exercised",
    description:
      "Not exercised in this tenant or prototype. Vendor documentation may describe a delivery path, but it is not implementation proof.",
    dot: "bg-zinc-400",
    chip: "border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400",
  },
}

const BASE_CIAM_CATEGORIES: BaseEvalCategory[] = [
  {
    id: "identity-lifecycle",
    title: "Identity Lifecycle Management",
    requirements: [
      {
        requirement: "User registration and onboarding",
        priority: "Must Have",
        inPoc: "Yes",
        status: "validated",
        detail:
          "Registration runs on Auth0 Universal Login. A new user can sign up and lands signed in, so the capability is validated without building a custom form. Field and validation choices are configuration, not a build.",
      },
      {
        requirement: "Multiple registration entry points and invitation-based registration",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "Built at /register: newsletter and product entry points apply contextual fields, validation, consent, and next tasks before converging on Auth0 Universal Login. Pro team invitations validate the inviter's organization membership and use Auth0 Organization Invitations when configured, with an explicit Demo fallback.",
      },
      {
        requirement: "Registration UX customization (branding, localization, field logic)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "validated",
        detail:
          "Universal Login supports branding, localization, and field logic through configuration, and our app is branded. Validated as a platform config capability.",
      },
      {
        requirement: "Account linking and merge (social login later linked to an email account)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail:
          "Connected accounts and the ways you sign in are managed live in the account center. Safe merge and conflict handling are not built. Cross-tenant linking is modelled by SBD Passport.",
      },
      {
        requirement: "Email and phone verification journeys (resend, expiry, deliverability)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail:
          "Changing an email resets email_verified and triggers Auth0's activation email, which validates the verification path. Full resend and expiry journeys are not built.",
      },
      {
        requirement: "Unique identifier strategy and duplicate handling across markets and brands",
        priority: "Must Have",
        inPoc: "No",
        status: "in-progress",
        detail: "SBD Passport models connecting one person across regional tenants using identifiers only. Making it real needs SBD development.",
      },
      {
        requirement: "Registration rate limiting, bot protection, and abuse prevention",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "Not exercised or capacity-tested in this POC. Auth0 documents native endpoint/API rate limits plus configurable Suspicious IP and Brute-force Protection; production still requires plan sizing, monitoring, 429 handling, safe load testing, and separate protection for SBD-owned endpoints.",
      },
      {
        requirement: "Account recovery (password reset and username recovery)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "The signed-out /recover flow supports password reset and account reminder using the email identifier. Every request gets the same privacy-safe response, with hashed request throttling and no provider or account-existence disclosure.",
      },
      {
        requirement: "Change password",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "Creates a real password-change ticket via the Management API.",
      },
      {
        requirement: "Progressive profiling",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "After a real sign-in, /welcome asks only for missing given name, family name, and phone. The step is optional, can be dismissed, saves to Auth0, and never controls access.",
      },
      {
        requirement: "Profile management",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "Edit name, photo, phone, and email via the Management API. Changing an email sends an activation email.",
      },
      {
        requirement: "Identity verification (email/phone verification, optional KYC)",
        priority: "Nice to Have",
        inPoc: "tbc",
        status: "in-progress",
        detail: "Signed-in email verification status and resend are live and session-scoped. Phone verification and optional KYC remain outside this bundle and need scope confirmation.",
      },
      {
        requirement: "A/B testing of registration",
        priority: "Nice to Have",
        inPoc: "No",
        status: "planned",
        detail: "Not exercised in this POC. Auth0 Experiment Center documents native deterministic registration experiments, runtime context, and log enrichment, but the current Beta is limited to development tenants and does not support production end-user traffic.",
      },
      {
        requirement: "Welcome and onboarding communications, post-registration tasks",
        priority: "Nice to Have",
        inPoc: "No",
        status: "built",
        detail: "The contextual registration completion page provides entry-point-aware verification guidance, progressive-profile follow-up, and next actions. It does not claim that an external welcome email or downstream campaign was sent.",
      },
      {
        requirement: "Legal agreement capture (Terms, Privacy) with versioning and proof of acceptance",
        priority: "Nice to Have",
        inPoc: "Yes",
        status: "built",
        detail: "Registration requires Terms and Privacy acknowledgement and records document versions, entry point, and acceptance timestamp. Signed-in Live mode writes an allow-listed receipt to Auth0 user_metadata; Demo mode labels the browser-session receipt honestly.",
      },
      {
        requirement: "Delegated administration (supplier or dealer manages their own staff)",
        priority: "Nice to Have",
        inPoc: "n/a",
        status: "planned",
        detail: "Out of POC scope (not a consumer requirement).",
      },
      {
        requirement: "Assisted onboarding (invite a user, create user) for dealers and suppliers",
        priority: "Nice to Have",
        inPoc: "Yes",
        status: "built",
        detail: "The Pro team flow supports organization-scoped user invitations. Live mode sends an Auth0 Organization Invitation only after server-side membership validation; Demo mode demonstrates the journey without claiming an email was sent.",
      },
    ],
  },
  {
    id: "profile-management",
    title: "Profile Management",
    requirements: [
      {
        requirement: "Custom fields",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail:
          "user_metadata stores custom attributes (preferences, consent, phone) through a typed schema. An admin UI to define new fields is not built, but adding fields is a small change.",
      },
      {
        requirement: "Data validation",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "Inputs are allow-listed and sanitized on every write. Configurable per-brand rules are not built.",
      },
      {
        requirement: "User preferences and communication settings",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "The Site preferences panel stores language, marketing choices, and channels, with consent provenance in user_metadata.",
      },
      {
        requirement: "User profile export",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "Self-service JSON export from the account center.",
      },
    ],
  },
  {
    id: "authentication",
    title: "Authentication and Authorization",
    requirements: [
      {
        requirement: "Login via email and password",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail: "Real Auth0 Universal Login.",
      },
      {
        requirement: "Login via social partners (Google, Facebook, and others)",
        priority: "Nice to Have",
        inPoc: "Yes",
        status: "built",
        detail: "Provider picker into the correct connection. Google is verified end to end.",
      },
      {
        requirement: "Multi-factor authentication (MFA)",
        priority: "Must Have",
        inPoc: "Yes (confirmed)",
        status: "built",
        detail: "Listing and removing enrolled factors is live via the Management API. Enrolling a new factor happens through Universal Login, which we validated.",
      },
      {
        requirement: "Passwordless email for consumers (magic link and email code)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail:
          "Both flows are wired to Universal Login on the shared email connection and go live once the tenant connection is enabled and a flag is set. The mock runs until then. The sheet's passwordless row targets supplier and dealer; this consumer variant is the one we built.",
      },
      {
        requirement: "Login via phone number and SMS one-time passcode (consumer)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "unknown",
        detail: "Not exercised in this tenant. Official documentation confirms Auth0 passwordless SMS OTP; production requires provider, connection, policy, and plan configuration.",
      },
      {
        requirement: "Single sign-on (SSO) using SAML 2.0 or OIDC",
        priority: "Must Have",
        inPoc: "TBD",
        status: "simulated",
        detail: "The employee SSO flow is a mock. The app itself authenticates over OIDC, but standards-based federation to an external IdP is not wired.",
      },
      {
        requirement: "Passwordless authentication (supplier or dealer)",
        priority: "N/A",
        inPoc: "n/a",
        status: "planned",
        detail: "Out of scope for consumers.",
      },
      {
        requirement: "Adaptive or risk-based authentication",
        priority: "TBD",
        inPoc: "No",
        status: "unknown",
        detail: "Auth0 offers this on the platform. Not validated here. Official documentation confirms the platform capability; it was not exercised in this tenant.",
      },
      {
        requirement: "Delegated administration (supplier or dealer manages store accounts)",
        priority: "N/A",
        inPoc: "n/a",
        status: "planned",
        detail: "Out of POC scope.",
      },
    ],
  },
  {
    id: "privacy-compliance",
    title: "Privacy and Compliance",
    requirements: [
      {
        requirement: "Consent management",
        priority: "Must Have",
        inPoc: "Yes",
        status: "built",
        detail:
          "The Consent and permissions panel grants and withdraws consent for marketing, data sharing, analytics, and personalization, stored in user_metadata. The topic list is easy to extend.",
      },
      {
        requirement: "Consent audit trails",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail:
          "The account panel shows consent-change rows successfully written to Neon. Audit writes are best-effort and do not block the current-state save, so this is not complete or tamper-proof evidence.",
      },
      {
        requirement: "Data subject access requests (DSAR)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail: "The POC covers Auth0 profile export and correction. Deletion can block or delete the Auth0 identity and send a best-effort webhook, but downstream erasure is not implemented or verified.",
      },
      {
        requirement: "Data residency and retention controls",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail: "Region routing and per-tenant residency are modelled, and deletion records a retention and SLA aware receipt. Configurable retention policies and scheduled purge are not built.",
      },
      {
        requirement: "Accessibility (WCAG) and localization",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail: "The UI uses semantic HTML, ARIA, and keyboard access. A formal WCAG 2.1 AA audit and full localization are not done. The language approach is to be confirmed.",
      },
      {
        requirement: "Privacy compliance (GDPR, CCPA, and others)",
        priority: "Must Have",
        inPoc: "No",
        status: "in-progress",
        detail: "Right to be forgotten, consent, and residency are built. A formal Records of Processing and DPIA sign-off with Legal remains.",
      },
      {
        requirement: "Data minimization",
        priority: "Nice to Have",
        inPoc: "n/a",
        status: "planned",
        detail: "We collect only what is needed, but attribute-level masking is not built.",
      },
      {
        requirement: "Privacy by design and DPIA support",
        priority: "Must Have",
        inPoc: "No",
        status: "planned",
        detail: "Production governance work: Auth0/Okta supplies platform evidence and controls, while SBD Legal owns the DPIA and privacy-by-design approval for the complete processing system.",
      },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    requirements: [
      {
        requirement: "Administrative reporting (accounts per market, by segment, login and registration volumes)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "simulated",
        detail: "The public /operations dashboard demonstrates current-tenant authentication, registration, verification, market, and security reporting with deterministic synthetic aggregates. Production ingestion and authorized access remain to be implemented.",
      },
      {
        requirement: "Custom reports and dashboards with BI integration",
        priority: "Must Have",
        inPoc: "Yes",
        status: "simulated",
        detail: "The interactive /operations dashboard validates the custom reporting experience and production data-path design. It does not yet connect Auth0 Logs or a downstream BI warehouse.",
      },
      {
        requirement: "Audit logging and SIEM integration (for example New Relic)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "unknown",
        detail: "Auth0 Log Streams can feed a SIEM. Streaming to New Relic is not validated here. Official documentation confirms the platform capability; it was not exercised in this tenant.",
      },
      {
        requirement: "Tenant and environment management (dev, test, prod, isolation, promotion, rollback)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail: "The multi-region tenant model is documented and explorable at /architecture. Environment promotion and rollback are platform capabilities to confirm and demo.",
      },
      {
        requirement: "Configuration and extensibility (fields, policies, workflows without heavy code)",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "To confirm with engineering and documentation.",
      },
      {
        requirement: "Email template branding (logos, colors, localization)",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "Auth0 supports branded, localized email templates. Not validated here. Official documentation confirms the platform capability; it was not exercised in this tenant.",
      },
      {
        requirement: "Email statistics (open and click rates)",
        priority: "Nice to Have",
        inPoc: "No",
        status: "planned",
        detail: "Not started.",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    requirements: [
      {
        requirement: "API and interfaces to expose identity data to downstream systems (CDP, PRS)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "planned",
        detail: "Not started. One example integration was requested.",
      },
      {
        requirement: "Real-time data synchronization to Treasure Data with a unique identifier",
        priority: "Must Have",
        inPoc: "Yes",
        status: "planned",
        detail: "Not started.",
      },
      {
        requirement: "Support for APIs and webhooks with secure auth and event subscriptions",
        priority: "Must Have",
        inPoc: "Yes",
        status: "in-progress",
        detail: "The erasure cascade uses a best-effort webhook fan-out. General event subscriptions are not built.",
      },
      {
        requirement: "SDKs for web and mobile with docs and sample apps",
        priority: "Must Have",
        inPoc: "Yes",
        status: "validated",
        detail: "Auth0 ships official SDKs and this app runs on the Next.js SDK, so the SDK path is validated. A dedicated mobile sample is to be confirmed.",
      },
      {
        requirement: "Instant cross-system updates with event ordering and conflict resolution",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "Not exercised in the POC. Auth0 documents APIs and event delivery; SBD and downstream systems still own ordering, retries, reconciliation, and conflict policy.",
      },
      {
        requirement: "SCIM 2.0 provisioning and deprovisioning",
        priority: "TBD",
        inPoc: "tbc",
        status: "unknown",
        detail: "Not started. Scope to be confirmed.",
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    requirements: [
      {
        requirement: "Password policies (complexity, history, lockout, rotation)",
        priority: "Must Have",
        inPoc: "Yes",
        status: "validated",
        detail: "Enforced by the Auth0 tenant policy and Universal Login. We validated that policy applies at sign-up and reset. This is configuration, not a build.",
      },
      {
        requirement: "Security standards support (OAuth 2.0, OIDC, SAML 2.0)",
        priority: "Must Have",
        inPoc: "No",
        status: "validated",
        detail: "The app authenticates over OAuth 2.0 and OIDC on every login, so those are validated in use. SAML is available on the platform but not exercised here.",
      },
      {
        requirement: "No plaintext passwords (secure hashing, secure reset)",
        priority: "Must Have",
        inPoc: "No",
        status: "validated",
        detail: "Auth0 hashes passwords and never exposes them, and our reset uses tickets, so the app never handles a raw password. Validated by how the flows work.",
      },
      {
        requirement: "Secure data storage and transmission (encryption at rest and in transit, modern TLS)",
        priority: "Must Have",
        inPoc: "No",
        status: "validated",
        detail: "All traffic is HTTPS, which validates encryption in transit. Encryption at rest is a documented platform assurance from Auth0.",
      },
      {
        requirement: "Account takeover and fraud detection (credential stuffing, brute force, anomalies)",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "Auth0 Attack Protection covers this. Not validated here. Official documentation confirms the platform capability; it was not exercised in this tenant.",
      },
      {
        requirement: "Key management and secrets handling (KMS or HSM, rotation, customer-managed keys)",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "Not exercised in the POC. Auth0/Okta documents managed-platform security; SBD remains responsible for application secrets, rotation, and any customer-managed KMS/HSM boundary.",
      },
      {
        requirement: "Vulnerability management and penetration test support",
        priority: "Must Have",
        inPoc: "No",
        status: "unknown",
        detail: "A vendor process. Official documentation confirms the platform capability; it was not exercised in this tenant.",
      },
    ],
  },
]

export const CIAM_CATEGORIES: EvalCategory[] = BASE_CIAM_CATEGORIES.map((category) => ({
  ...category,
  requirements: category.requirements.map((requirement) => ({
    ...requirement,
    ...requirementEvidence(requirement.requirement, category.id),
  })),
}))

export interface EvalSummary {
  total: number
  counts: Record<EvalStatus, number>
}

/** Count requirements by status across every category. */
export function evalSummary(): EvalSummary {
  const counts = {
    built: 0,
    validated: 0,
    "in-progress": 0,
    simulated: 0,
    planned: 0,
    unknown: 0,
  } as Record<EvalStatus, number>
  let total = 0
  for (const category of CIAM_CATEGORIES) {
    for (const req of category.requirements) {
      counts[req.status] += 1
      total += 1
    }
  }
  return { total, counts }
}
