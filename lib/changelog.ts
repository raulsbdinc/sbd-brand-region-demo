// POC changelog. One source of truth for the /changelog page.
//
// How to use this file:
// - Today's build is 0.1.0. Add a new entry at the TOP of CHANGELOG for each
//   iteration and bump the version.
// - We are working toward 1.0.0, which is when the POC scope is considered
//   done (see the "Road to 1.0.0" note on the /changelog page).
// - Keep entries short and factual. No marketing language.

export type ChangeKind = "added" | "changed" | "fixed" | "removed"

export interface ChangelogChange {
  kind: ChangeKind
  text: string
}

export interface ChangelogEntry {
  version: string
  // ISO date, e.g. "2026-07-10".
  date: string
  // A short, plain title for the release.
  title: string
  // One or two sentences on what this release is about.
  summary: string
  changes: ChangelogChange[]
}

export const CURRENT_VERSION = "0.2.0"

// The version at which the POC scope is considered complete.
export const TARGET_VERSION = "1.0.0"

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.2.0",
    date: "2026-07-10",
    title: "CIAM evaluation page and clearer navigation",
    summary:
      "The CIAM evaluation requirements now have their own page and doc, with a status taxonomy that separates what we built from what we validated on the platform and what is still open. Navigation is reorganized around a POC menu.",
    changes: [
      {
        kind: "added",
        text: "CIAM evaluation page at /evaluation: every requirement from the sheet, grouped by the seven categories, filterable by status.",
      },
      {
        kind: "added",
        text: "Added separate statuses for features exercised through Auth0 and features not exercised in this tenant. The current labels are Built in POC, Feature exercised, Partly connected, Demo only, Production work, and Not exercised.",
      },
      {
        kind: "added",
        text: "CIAM_EVALUATION.md doc, readable at /docs, explaining the status taxonomy and linking to the page. It and the page share one source in lib/ciam-evaluation.ts.",
      },
      {
        kind: "changed",
        text: "Navigation reorganized: a header POC menu groups the evaluation, architecture, sign-in method pages, docs, and changelog. The footer now mirrors those groups.",
      },
      {
        kind: "changed",
        text: "The feature backlog no longer duplicates the evaluation table. Part 2 is now a short pointer to the page and doc.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-07-10",
    title: "First tracked build",
    summary:
      "This is the starting point for the changelog. It records the state of the prototype as of today. From here each iteration gets its own version until we reach 1.0.0.",
    changes: [
      {
        kind: "added",
        text: "Sign-in showcase with seven methods: classic password, social, passwordless email (code and magic link), passkey, employee SSO, and QR invite.",
      },
      {
        kind: "added",
        text: "Real Auth0 sign-in for classic password and social. Passwordless email is wired but stays in mock mode until the tenant email connection is enabled.",
      },
      {
        kind: "added",
        text: "Account center at /account that reads a real Auth0 session and manages profile, email, password reset, MFA, passkeys, connected accounts, organizations, and data export against the Management API. It falls back to a Demo view when the Management API is not configured.",
      },
      {
        kind: "added",
        text: "Consent and permissions panel with an append-only consent audit trail stored in Neon Postgres.",
      },
      {
        kind: "added",
        text: "Right to be forgotten: reversible soft delete, optional hard delete, a region-aware erasure receipt, and a best-effort downstream cascade. A soft delete can be undone from the admin restore tool.",
      },
      {
        kind: "added",
        text: "Site preferences panel: storefront country, locale, email language, and communication choices stored in user_metadata.",
      },
      {
        kind: "added",
        text: "Multi-region tenant proposal at /architecture: every SBD entity market grouped by privacy law and location into four tenants plus China.",
      },
      {
        kind: "added",
        text: "Region routing: a header region switcher that routes real sign-ins to the selected region's Auth0 tenant, with a shared-app fallback until per-region credentials are set.",
      },
      {
        kind: "added",
        text: "SBD Passport at /passport: a single place to view and link a customer's regional accounts, storing identifiers only.",
      },
      {
        kind: "added",
        text: "In-app documentation at /docs that renders the README, product overview, and feature backlog straight from the repository.",
      },
      {
        kind: "added",
        text: "Friendly sign-in error page and a centralized sign-out path shared by every surface.",
      },
    ],
  },
]
