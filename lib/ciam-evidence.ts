export type SupportType =
  | "native"
  | "configurable"
  | "extensible"
  | "integration"
  | "sbd"

export interface OfficialSource {
  label: string
  url: string
}

export interface RequirementEvidence {
  support: SupportType
  responsibility: string
  sources: OfficialSource[]
  prerequisite?: string
}

export const SUPPORT_ORDER: SupportType[] = [
  "native",
  "configurable",
  "extensible",
  "integration",
  "sbd",
]

export const SUPPORT_META: Record<
  SupportType,
  { label: string; short: string; description: string; chip: string }
> = {
  native: {
    label: "Auth0 native",
    short: "Native",
    description: "Auth0 operates the core capability as part of the identity platform.",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
  configurable: {
    label: "Auth0 configurable",
    short: "Configurable",
    description: "Delivered by Auth0 through tenant, connection, policy, branding, or plan configuration.",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-700",
  },
  extensible: {
    label: "Auth0 extensible",
    short: "Extensible",
    description: "Auth0 supplies Actions, Forms, APIs, metadata, or events; SBD composes the business workflow.",
    chip: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700",
  },
  integration: {
    label: "Integration / partner",
    short: "Integration",
    description: "Auth0 is the identity source or control point, while another system delivers the specialist capability.",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  },
  sbd: {
    label: "SBD responsibility",
    short: "SBD-owned",
    description: "A business, legal, governance, or application decision—not a feature an identity provider can own.",
    chip: "border-slate-400/40 bg-slate-400/10 text-slate-700",
  },
}

const DOCS = {
  universalLogin: { label: "Universal Login", url: "https://auth0.com/docs/authenticate/login/auth0-universal-login" },
  signup: { label: "Database connections", url: "https://auth0.com/docs/authenticate/database-connections" },
  organizations: { label: "Auth0 Organizations", url: "https://auth0.com/docs/manage-users/organizations" },
  invitations: { label: "Organization invitations", url: "https://auth0.com/docs/manage-users/organizations/configure-organizations/send-membership-invitations" },
  branding: { label: "Universal Login branding", url: "https://auth0.com/docs/customize/login-pages/universal-login/customize-templates" },
  prompts: { label: "Prompts and language", url: "https://auth0.com/docs/customize/login-pages/universal-login/customize-text-elements" },
  accountLinking: { label: "User account linking", url: "https://auth0.com/docs/manage-users/user-accounts/user-account-linking" },
  verification: { label: "Verify emails", url: "https://auth0.com/docs/manage-users/user-accounts/verify-emails" },
  users: { label: "Manage user profiles", url: "https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api" },
  metadata: { label: "User metadata", url: "https://auth0.com/docs/manage-users/user-accounts/metadata" },
  passwordReset: { label: "Password reset", url: "https://auth0.com/docs/authenticate/database-connections/password-change" },
  actions: { label: "Auth0 Actions", url: "https://auth0.com/docs/customize/actions" },
  forms: { label: "Auth0 Forms", url: "https://auth0.com/docs/customize/forms" },
  experimentCenter: { label: "Experiment Center overview", url: "https://auth0.com/docs/customize/experiment-center/overview" },
  attack: { label: "Attack Protection", url: "https://auth0.com/docs/secure/attack-protection" },
  rateLimitPolicy: { label: "Rate Limit Policy", url: "https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy" },
  rateLimitConfigurations: { label: "Rate Limit Configurations", url: "https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-configurations" },
  rateLimitUseCases: { label: "Rate Limit Use Cases", url: "https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-use-cases" },
  suspiciousIp: { label: "Suspicious IP Throttling", url: "https://auth0.com/docs/secure/attack-protection/suspicious-ip-throttling" },
  bruteForce: { label: "Brute-force Protection", url: "https://auth0.com/docs/secure/attack-protection/brute-force-protection" },
  social: { label: "Social identity providers", url: "https://auth0.com/docs/authenticate/identity-providers/social-identity-providers" },
  mfa: { label: "Multi-factor authentication", url: "https://auth0.com/docs/secure/multi-factor-authentication" },
  passwordless: { label: "Passwordless authentication", url: "https://auth0.com/docs/authenticate/passwordless" },
  sms: { label: "Passwordless SMS", url: "https://auth0.com/docs/authenticate/passwordless/authentication-methods/sms-otp" },
  enterprise: { label: "Enterprise identity providers", url: "https://auth0.com/docs/authenticate/identity-providers/enterprise-identity-providers" },
  adaptive: { label: "Adaptive MFA", url: "https://auth0.com/docs/secure/multi-factor-authentication/adaptive-mfa" },
  export: { label: "Export users", url: "https://auth0.com/docs/manage-users/user-migration/bulk-user-exports" },
  delete: { label: "Delete users", url: "https://auth0.com/docs/manage-users/user-accounts/delete-users" },
  compliance: { label: "Okta Trust and compliance", url: "https://www.okta.com/trust/" },
  accessibility: { label: "Universal Login", url: "https://auth0.com/docs/authenticate/login/auth0-universal-login" },
  logs: { label: "Auth0 logs", url: "https://auth0.com/docs/deploy-monitor/logs" },
  logStreams: { label: "Log Streams", url: "https://auth0.com/docs/customize/log-streams" },
  deployCli: { label: "Deploy CLI", url: "https://auth0.com/docs/deploy-monitor/deploy-cli-tool" },
  emailTemplates: { label: "Email templates", url: "https://auth0.com/docs/customize/email/email-templates" },
  managementApi: { label: "Management API", url: "https://auth0.com/docs/api/management/v2" },
  apis: { label: "Access tokens", url: "https://auth0.com/docs/secure/tokens/access-tokens" },
  eventStreams: { label: "Log Streams", url: "https://auth0.com/docs/customize/log-streams" },
  sdks: { label: "Auth0 SDK libraries", url: "https://auth0.com/docs/libraries" },
  scim: { label: "Inbound SCIM", url: "https://auth0.com/docs/authenticate/protocols/scim" },
  passwordPolicy: { label: "Password policies", url: "https://auth0.com/docs/authenticate/database-connections/password-strength" },
  protocols: { label: "Authentication protocols", url: "https://auth0.com/docs/authenticate/protocols" },
  security: { label: "Auth0 security", url: "https://auth0.com/docs/secure" },
  trust: { label: "Okta Trust Center", url: "https://www.okta.com/trust/" },
} as const

const has = (value: string, expression: RegExp) => expression.test(value)

export function requirementEvidence(requirement: string, categoryId: string): RequirementEvidence {
  if (has(requirement, /A\/B testing/)) {
    return {
      support: "native",
      responsibility: "Auth0 Experiment Center owns experiment definitions, deterministic assignment, runtime context, and log enrichment. SBD owns hypotheses, success metrics, downstream analysis, ethics and governance, and manual promotion of the winning variation.",
      sources: [DOCS.experimentCenter],
      prerequisite: "Experiment Center is currently Beta: development tenants only, no production end-user traffic, one active experiment per tenant, customer-side results analysis, and manual winner promotion.",
    }
  }
  if (has(requirement, /DPIA|Privacy compliance|Data minimization/)) {
    return { support: "sbd", responsibility: "SBD owns the legal and governance outcome. Auth0 supplies identity data, security evidence, and privacy controls that support it.", sources: [DOCS.compliance, DOCS.actions] }
  }
  if (has(requirement, /KYC|identity verification/i)) {
    return { support: "integration", responsibility: "Auth0 handles authentication and verified contact attributes; a specialist identity-proofing provider and SBD policy deliver KYC.", sources: [DOCS.verification, DOCS.actions] }
  }
  if (has(requirement, /Email statistics/)) {
    return { support: "integration", responsibility: "Auth0 sends transactional templates; the configured email provider or campaign platform owns open and click analytics.", sources: [DOCS.emailTemplates, DOCS.logStreams] }
  }
  if (has(requirement, /Treasure Data|cross-system updates|conflict resolution/)) {
    return { support: "integration", responsibility: "Auth0 supplies stable identity identifiers, APIs, and events. Treasure Data and SBD own delivery, ordering, reconciliation, and merge policy.", sources: [DOCS.eventStreams, DOCS.managementApi, DOCS.logStreams] }
  }
  if (has(requirement, /report|dashboard|SIEM|audit logging/i)) {
    return { support: "integration", responsibility: "Auth0 produces tenant logs and streams. SBD's analytics or SIEM platform owns retained reporting, dashboards, and operational access.", sources: [DOCS.logs, DOCS.logStreams] }
  }
  if (has(requirement, /customer-managed keys|Key management|secrets handling/)) {
    return { support: "integration", responsibility: "Auth0 protects its managed platform keys; SBD owns application secrets, rotation, and any customer-managed KMS/HSM boundary.", sources: [DOCS.security, DOCS.trust] }
  }
  if (has(requirement, /Vulnerability|penetration/)) {
    return { support: "integration", responsibility: "Okta/Auth0 owns platform assurance; SBD owns application testing, vendor review, and remediation governance.", sources: [DOCS.trust, DOCS.compliance] }
  }
  if (has(requirement, /registration entry|invitation|Assisted onboarding|Delegated administration/)) return { support: "configurable", responsibility: "Configure Organizations, membership, invitations, and delegated business rules; SBD defines who may administer whom.", sources: [DOCS.organizations, DOCS.invitations] }
  if (has(requirement, /registration UX|branding|localization|Accessibility/)) return { support: "configurable", responsibility: "Auth0 provides accessible Universal Login prompts, branding, and localization; SBD supplies approved content and completes accessibility assurance.", sources: [DOCS.branding, DOCS.prompts, DOCS.accessibility] }
  if (has(requirement, /Account linking|duplicate|Unique identifier/)) return { support: "extensible", responsibility: "Auth0 provides immutable user IDs and account-linking APIs. SBD owns safe match, consent, conflict, and cross-tenant identity policy.", sources: [DOCS.accountLinking, DOCS.users] }
  if (has(requirement, /verification|Email and phone/i)) return { support: "configurable", responsibility: "Auth0 provides verification and OTP capabilities; SBD configures channels, providers, templates, expiry, and recovery policy.", sources: [DOCS.verification, DOCS.sms] }
  if (has(requirement, /Registration rate limiting/)) return {
    support: "configurable",
    responsibility: "Auth0 enforces service and endpoint limits and provides Attack Protection controls, rate-limit headers, HTTP 429 responses, and tenant log signals. SBD selects and sizes the subscription, estimates request amplification, tunes controls, monitors thresholds, implements bounded retry/backoff, protects custom endpoints, and validates capacity with approved testing.",
    sources: [DOCS.rateLimitPolicy, DOCS.rateLimitConfigurations, DOCS.rateLimitUseCases, DOCS.suspiciousIp, DOCS.bruteForce],
    prerequisite: "Limits vary by API, endpoint, tenant type, and subscription. Performance Burst and extensibility concurrency require eligible configurations. This POC was not tuned or load-tested.",
  }
  if (has(requirement, /bot protection|abuse|fraud|credential stuffing|brute force|anomal/)) return { support: "configurable", responsibility: "Enable and tune Auth0 Attack Protection and adaptive controls for each tenant and subscription.", sources: [DOCS.attack, DOCS.adaptive, DOCS.suspiciousIp, DOCS.bruteForce], prerequisite: "Availability and controls vary by Auth0 plan." }
  if (has(requirement, /recovery|password reset|Change password/)) return { support: "native", responsibility: "Auth0 operates secure password-change tickets, reset flows, and privacy-safe recovery behavior.", sources: [DOCS.passwordReset] }
  if (has(requirement, /Progressive profiling|Custom fields|Data validation|preferences|Consent management|Legal agreement|Welcome and onboarding/)) return { support: "extensible", responsibility: "Auth0 supplies metadata, Actions, and Forms; SBD defines fields, validation, consent language, versions, and downstream tasks.", sources: [DOCS.metadata, DOCS.actions, DOCS.forms] }
  if (has(requirement, /Profile management/)) return { support: "native", responsibility: "Auth0 stores profiles and exposes scoped Management API operations; SBD decides editable attributes and authorization.", sources: [DOCS.users, DOCS.metadata] }
  if (has(requirement, /profile export|Data subject access|DSAR/)) return { support: "extensible", responsibility: "Auth0 provides user retrieval, export, update, and deletion APIs; SBD orchestrates the complete cross-system privacy request.", sources: [DOCS.export, DOCS.delete, DOCS.managementApi] }
  if (has(requirement, /email and password|User registration/)) return { support: "native", responsibility: "Auth0 Universal Login and database connections provide hosted registration and authentication.", sources: [DOCS.universalLogin, DOCS.signup] }
  if (has(requirement, /social partners/)) return { support: "configurable", responsibility: "Enable the required social connections and supply provider credentials per environment.", sources: [DOCS.social] }
  if (has(requirement, /Multi-factor|MFA/)) return { support: "configurable", responsibility: "Auth0 owns factor enrollment and challenges; SBD configures factors and enrollment policy.", sources: [DOCS.mfa, DOCS.adaptive], prerequisite: "Factor and adaptive options vary by plan." }
  if (has(requirement, /Passwordless|phone number|SMS one-time/)) return { support: "configurable", responsibility: "Auth0 owns OTP generation and verification; SBD configures the connection, provider, templates, and abuse controls.", sources: [DOCS.passwordless, DOCS.sms] }
  if (has(requirement, /SAML|OIDC|Single sign-on|Security standards/)) return { support: "configurable", responsibility: "Auth0 supports standards-based federation; SBD configures each enterprise connection and trust relationship.", sources: [DOCS.enterprise, DOCS.protocols] }
  if (has(requirement, /Adaptive|risk-based/)) return { support: "configurable", responsibility: "Configure Auth0 Adaptive MFA and risk policy for eligible tenants.", sources: [DOCS.adaptive], prerequisite: "Requires an eligible Auth0 plan." }
  if (has(requirement, /residency|retention/)) return { support: "configurable", responsibility: "Select tenant regions and configure platform retention where available; SBD governs downstream copies and legal retention schedules.", sources: [DOCS.compliance, DOCS.logs] }
  if (has(requirement, /Tenant and environment|promotion|rollback/)) return { support: "configurable", responsibility: "Use isolated tenants and Deploy CLI configuration promotion; SBD owns release approvals, secrets, rollback, and regional topology.", sources: [DOCS.deployCli, DOCS.compliance] }
  if (has(requirement, /Configuration and extensibility/)) return { support: "extensible", responsibility: "Auth0 provides Actions, Forms, metadata, APIs, and deployable configuration; SBD composes business workflows.", sources: [DOCS.actions, DOCS.forms, DOCS.deployCli] }
  if (has(requirement, /Email template/)) return { support: "configurable", responsibility: "SBD configures Auth0 templates, provider, branding, and localized content.", sources: [DOCS.emailTemplates] }
  if (has(requirement, /API and interfaces|APIs and webhooks|event subscriptions/)) return { support: "extensible", responsibility: "Auth0 supplies OAuth-protected APIs, Actions, and event delivery; SBD defines downstream contracts and authorization.", sources: [DOCS.managementApi, DOCS.apis, DOCS.eventStreams] }
  if (has(requirement, /SDKs/)) return { support: "native", responsibility: "Use supported Auth0 SDKs while SBD owns application integration and lifecycle upgrades.", sources: [DOCS.sdks] }
  if (has(requirement, /SCIM/)) return { support: "configurable", responsibility: "Configure Auth0 inbound SCIM for supported enterprise provisioning scenarios and map SBD attributes.", sources: [DOCS.scim], prerequisite: "SCIM availability and use cases depend on plan and connection type." }
  if (has(requirement, /Password policies/)) return { support: "configurable", responsibility: "Configure database-connection password strength and attack controls; SBD approves policy.", sources: [DOCS.passwordPolicy, DOCS.attack] }
  if (has(requirement, /plaintext passwords/)) return { support: "native", responsibility: "Auth0 owns password hashing and secure reset; SBD applications never receive or store user passwords.", sources: [DOCS.passwordReset, DOCS.security] }
  if (has(requirement, /storage and transmission|encryption/)) return { support: "native", responsibility: "Auth0/Okta owns platform encryption and transport security; SBD secures its application and downstream stores.", sources: [DOCS.security, DOCS.trust] }

  return {
    support: categoryId === "privacy-compliance" ? "sbd" : "extensible",
    responsibility: categoryId === "privacy-compliance"
      ? "SBD owns the legal and governance outcome; Auth0 provides identity controls, APIs, and evidence that support it."
      : "Auth0 provides the identity platform and extension points; SBD configures the production policy and business workflow.",
    sources: categoryId === "privacy-compliance" ? [DOCS.compliance, DOCS.managementApi] : [DOCS.actions, DOCS.managementApi],
  }
}
