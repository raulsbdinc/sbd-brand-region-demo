// MULTI-REGION TENANT ARCHITECTURE (target model)
// ================================================
// Okta's recommended topology for SBD, captured here so the /architecture page
// and the docs stay in sync:
//
//   - ONE Auth0 / Okta TENANT per region.   (data residency + isolation)
//   - ONE APPLICATION per site.             (each storefront / portal = a client)
//
// A tenant is *hosted* in one of the six data-residency locations Okta offers
// (Australia, Canada, EU, Japan, UK, US). We do NOT spin up a tenant per
// country — that would mean dozens of near-empty tenants (many SBD markets have
// well under 100 active users a month). Instead this file proposes a small set
// of tenants chosen on two axes:
//
//   1. PRIVACY REGIME  — markets are only pooled with others whose privacy law
//      and cross-border-transfer rules allow their data to live in the same
//      hosting region.
//   2. MARKET PROXIMITY — within what privacy allows, markets are grouped by
//      geography / shared SBD org so latency and operations stay sensible.
//
// SCOPE: this models only the markets where SBD has a legal entity. Markets
// without an SBD entity are out of scope and intentionally omitted to keep the
// footprint focused. The result is 4 active tenants (Americas, EMEA, APAC,
// Japan) plus China as a dedicated out-of-model case. See TENANTS below.
//
// IMPORTANT — this is the TARGET architecture, modelled for the showcase. The
// proof of concept today is a SINGLE application inside a SINGLE demo tenant
// (see CURRENT_POC). Nothing here provisions real tenants, and none of the
// privacy mappings are legal advice — they are a scoping aid to be confirmed
// with Legal.

/** The six data-residency locations Okta can host a tenant in. */
export type HostingRegionId = "us" | "ca" | "eu" | "uk" | "jp" | "au"

export interface HostingRegion {
  id: HostingRegionId
  name: string
  /** Two-letter badge, e.g. "US". */
  code: string
  /** Where the data physically lives, in plain terms. */
  dataCenter: string
}

/**
 * Okta's six hosting regions, exactly as offered in the tenant creation screen.
 * Picking one decides where that tenant's customer data is stored.
 */
export const HOSTING_REGIONS: Record<HostingRegionId, HostingRegion> = {
  us: { id: "us", name: "United States", code: "US", dataCenter: "United States data center" },
  ca: { id: "ca", name: "Canada", code: "CA", dataCenter: "Canada data center" },
  eu: { id: "eu", name: "European Union", code: "EU", dataCenter: "EU data center (e.g. for GDPR)" },
  uk: { id: "uk", name: "United Kingdom", code: "UK", dataCenter: "United Kingdom data center" },
  jp: { id: "jp", name: "Japan", code: "JP", dataCenter: "Japan data center" },
  au: { id: "au", name: "Australia", code: "AU", dataCenter: "Australia data center" },
}

/** Order to render the hosting-region options in. Mirrors the Okta screen. */
export const HOSTING_REGION_ORDER: HostingRegionId[] = ["au", "ca", "eu", "jp", "uk", "us"]

// ---------------------------------------------------------------------------
// Privacy regimes
// ---------------------------------------------------------------------------

/** How non-essential cookies / tracking may run under a regime. */
export type CookieModel = "opt-in" | "opt-out" | "notice"

/** How freely personal data may leave the country. */
export type TransferRule = "strict" | "safeguard" | "none" | "unique"

export interface PrivacyRegime {
  id: string
  /** Short human label, e.g. "EU / EEA — GDPR". */
  label: string
  /** The governing law(s), abbreviated. */
  law: string
  cookie: CookieModel
  transfer: TransferRule
  /** One plain-English line on the posture. */
  summary: string
}

export const COOKIE_LABELS: Record<CookieModel, string> = {
  "opt-in": "Opt-in consent",
  "opt-out": "Opt-out / notice",
  notice: "Notice-based",
}

export const TRANSFER_LABELS: Record<TransferRule, string> = {
  strict: "Mechanism required",
  safeguard: "Safeguard / accountability",
  none: "No restriction",
  unique: "Localized (special regime)",
}

/**
 * Privacy regimes covering SBD's entity markets, grouped to a useful level.
 * Derived from the internal "SBD Countries by Privacy Regime" scoping doc.
 */
export const PRIVACY_REGIMES: Record<string, PrivacyRegime> = {
  "eu-gdpr": {
    id: "eu-gdpr",
    label: "EU / EEA — GDPR",
    law: "GDPR + ePrivacy",
    cookie: "opt-in",
    transfer: "strict",
    summary: "Strictest baseline: opt-in cookies, lawful basis for all processing, full data-subject rights, transfers need a safeguard.",
  },
  "uk-gdpr": {
    id: "uk-gdpr",
    label: "United Kingdom — UK GDPR",
    law: "UK GDPR + DPA 2018",
    cookie: "opt-in",
    transfer: "strict",
    summary: "GDPR-identical with its own adequacy framework; mutual adequacy with the EEA.",
  },
  "ch-fadp": {
    id: "ch-fadp",
    label: "Switzerland — revFADP",
    law: "revFADP 2023",
    cookie: "opt-in",
    transfer: "strict",
    summary: "Near-identical to GDPR; transfers need Swiss adequacy or standard clauses.",
  },
  "us-state": {
    id: "us-state",
    label: "United States — state patchwork",
    law: "CCPA/CPRA + ~20 states",
    cookie: "opt-out",
    transfer: "none",
    summary: "No federal law; opt-out model (Do Not Sell/Share), sensitive data opt-in, no transfer restriction.",
  },
  "ca-quebec": {
    id: "ca-quebec",
    label: "Canada — PIPEDA + Quebec Law 25",
    law: "PIPEDA + Law 25",
    cookie: "opt-in",
    transfer: "safeguard",
    summary: "Quebec Law 25 sets the floor: opt-in for non-essential cookies, privacy impact assessment before transfers.",
  },
  "br-lgpd": {
    id: "br-lgpd",
    label: "Brazil — LGPD",
    law: "LGPD",
    cookie: "opt-in",
    transfer: "strict",
    summary: "GDPR-inspired with an active regulator (ANPD); lawful basis required, transfers need adequacy or SCCs.",
  },
  "latam-gdpr": {
    id: "latam-gdpr",
    label: "Latin America — GDPR-modeled",
    law: "Chile 21.719 / Ecuador LOPDP",
    cookie: "opt-in",
    transfer: "strict",
    summary: "Newer GDPR-modeled laws: opt-in, full rights, 72-hour breach notice, transfer safeguards.",
  },
  "latam-adequacy": {
    id: "latam-adequacy",
    label: "Latin America — EU adequacy",
    law: "Argentina 25.326",
    cookie: "notice",
    transfer: "safeguard",
    summary: "Older consent-based law holding EU adequacy; transfers to adequate countries permitted.",
  },
  "latam-consent": {
    id: "latam-consent",
    label: "Latin America — consent-based",
    law: "Mexico / Colombia / Peru",
    cookie: "notice",
    transfer: "safeguard",
    summary: "Consent + ARCO-style rights; transfers require recipient to ensure adequate protection.",
  },
  "jp-appi": {
    id: "jp-appi",
    label: "Japan — APPI",
    law: "APPI (2022)",
    cookie: "opt-out",
    transfer: "safeguard",
    summary: "Notice + opt-out for third-party provision; EU mutual adequacy; consent for sensitive data.",
  },
  "kr-pipa": {
    id: "kr-pipa",
    label: "South Korea — PIPA",
    law: "PIPA (2023)",
    cookie: "opt-in",
    transfer: "strict",
    summary: "Among the strictest: explicit opt-in for collection, disclosure and cross-border transfer.",
  },
  "au-privacy": {
    id: "au-privacy",
    label: "Australia — Privacy Act",
    law: "Privacy Act 1988 (APPs)",
    cookie: "opt-out",
    transfer: "safeguard",
    summary: "13 APPs; notice + opt-out baseline; discloser stays accountable for overseas recipients.",
  },
  "nz-privacy": {
    id: "nz-privacy",
    label: "New Zealand — Privacy Act 2020",
    law: "Privacy Act 2020",
    cookie: "opt-out",
    transfer: "safeguard",
    summary: "13 IPPs; cross-border disclosure allowed where comparable protection or safeguards exist.",
  },
  "sg-pdpa": {
    id: "sg-pdpa",
    label: "Singapore — PDPA",
    law: "PDPA 2012 (am. 2020)",
    cookie: "opt-in",
    transfer: "safeguard",
    summary: "Opt-in for non-essential cookies; transfers to comparable countries or via contracts.",
  },
  "my-pdpa": {
    id: "my-pdpa",
    label: "Malaysia — PDPA",
    law: "PDPA 2010",
    cookie: "opt-out",
    transfer: "strict",
    summary: "Consent-based; transfers prohibited unless the recipient country is on the approved list.",
  },
  "th-pdpa": {
    id: "th-pdpa",
    label: "Thailand — PDPA",
    law: "PDPA 2019",
    cookie: "opt-in",
    transfer: "strict",
    summary: "GDPR-influenced: opt-in cookies, full rights, transfers need adequacy or SCCs.",
  },
  "tw-pdpa": {
    id: "tw-pdpa",
    label: "Taiwan — PDPA",
    law: "PDPA",
    cookie: "opt-out",
    transfer: "none",
    summary: "Notice + purpose limitation; consent for sensitive data; transfers may need regulator approval.",
  },
  "id-pdp": {
    id: "id-pdp",
    label: "Indonesia — PDP Law",
    law: "PDP Law 27/2022",
    cookie: "opt-in",
    transfer: "strict",
    summary: "In force Oct 2024; consent or lawful basis; transfers need equivalent protection or contracts.",
  },
  "in-dpdp": {
    id: "in-dpdp",
    label: "India — DPDP Act",
    law: "DPDP 2023 (rules pending)",
    cookie: "opt-in",
    transfer: "strict",
    summary: "Consent-based; transfers to a government whitelist; implementing rules still outstanding.",
  },
  "cn-pipl": {
    id: "cn-pipl",
    label: "China — PIPL",
    law: "PIPL + DSL + CSL",
    cookie: "opt-in",
    transfer: "unique",
    summary: "Data localization + CAC Security Assessment / Standard Contract for cross-border identity data.",
  },
  "ae-pdpl": {
    id: "ae-pdpl",
    label: "UAE / Middle East — PDPL",
    law: "PDPL + DIFC / ADGM",
    cookie: "opt-in",
    transfer: "safeguard",
    summary: "Federal PDPL plus GDPR-equivalent free-zone laws (DIFC, ADGM); transfers via adequacy or contracts.",
  },
  "il-privacy": {
    id: "il-privacy",
    label: "Israel — Protection of Privacy Law",
    law: "PPL 5741-1981",
    cookie: "notice",
    transfer: "none",
    summary: "Consent-based with EU adequacy, easing EU–Israel flows; modernization under consideration.",
  },
  "ma-0908": {
    id: "ma-0908",
    label: "Morocco — Law 09-08",
    law: "Law 09-08",
    cookie: "notice",
    transfer: "strict",
    summary: "Consent-based; transfers need CNDP authorization unless the destination is adequate.",
  },
  "tr-kvkk": {
    id: "tr-kvkk",
    label: "Turkey — KVKK",
    law: "KVKK No. 6698",
    cookie: "opt-in",
    transfer: "strict",
    summary: "GDPR-modeled; opt-in cookies; transfers via KVKK adequacy list, consent, or approved BCRs.",
  },
}

// ---------------------------------------------------------------------------
// Markets (every supported market where SBD has a legal entity)
// ---------------------------------------------------------------------------

export interface Market {
  country: string
  /** ISO 3166-1 alpha-2 code. */
  a2: string
  /** Primary locale used by the storefront. */
  locale: string
  /** Key into PRIVACY_REGIMES. */
  regime: string
  /** Tenant id this market is assigned to. */
  tenant: string
}

/**
 * Every SBD entity market, mapped to a privacy regime and a target tenant.
 * Markets without an SBD legal entity are out of scope and omitted.
 * Locales are from the internal supported-countries scoping doc.
 */
export const MARKETS: Market[] = [
  // ---- Americas (hosted US) ----
  { country: "United States", a2: "US", locale: "en-US", regime: "us-state", tenant: "americas" },
  { country: "Canada", a2: "CA", locale: "en-CA / fr-CA", regime: "ca-quebec", tenant: "americas" },
  { country: "Mexico", a2: "MX", locale: "es-MX", regime: "latam-consent", tenant: "americas" },
  { country: "Brazil", a2: "BR", locale: "pt-BR", regime: "br-lgpd", tenant: "americas" },
  { country: "Argentina", a2: "AR", locale: "es-AR", regime: "latam-adequacy", tenant: "americas" },
  { country: "Chile", a2: "CL", locale: "es-CL", regime: "latam-gdpr", tenant: "americas" },
  { country: "Colombia", a2: "CO", locale: "es-CO", regime: "latam-consent", tenant: "americas" },
  { country: "Peru", a2: "PE", locale: "es-PE", regime: "latam-consent", tenant: "americas" },
  { country: "Ecuador", a2: "EC", locale: "es-EC", regime: "latam-gdpr", tenant: "americas" },

  // ---- EMEA (hosted EU) ----
  { country: "Ireland", a2: "IE", locale: "en-IE", regime: "eu-gdpr", tenant: "emea" },
  { country: "France", a2: "FR", locale: "fr-FR", regime: "eu-gdpr", tenant: "emea" },
  { country: "Germany", a2: "DE", locale: "de-DE", regime: "eu-gdpr", tenant: "emea" },
  { country: "Denmark", a2: "DK", locale: "da-DK", regime: "eu-gdpr", tenant: "emea" },
  { country: "Sweden", a2: "SE", locale: "sv-SE", regime: "eu-gdpr", tenant: "emea" },
  { country: "Italy", a2: "IT", locale: "it-IT", regime: "eu-gdpr", tenant: "emea" },
  { country: "Norway", a2: "NO", locale: "no-NO", regime: "eu-gdpr", tenant: "emea" },
  { country: "Finland", a2: "FI", locale: "sv-FI", regime: "eu-gdpr", tenant: "emea" },
  { country: "Spain", a2: "ES", locale: "es-ES", regime: "eu-gdpr", tenant: "emea" },
  { country: "Greece", a2: "GR", locale: "el-GR", regime: "eu-gdpr", tenant: "emea" },
  { country: "Poland", a2: "PL", locale: "pl-PL", regime: "eu-gdpr", tenant: "emea" },
  { country: "Austria", a2: "AT", locale: "de-AT", regime: "eu-gdpr", tenant: "emea" },
  { country: "Hungary", a2: "HU", locale: "hu-HU", regime: "eu-gdpr", tenant: "emea" },
  { country: "Belgium / Luxembourg", a2: "BE", locale: "nl-BE", regime: "eu-gdpr", tenant: "emea" },
  { country: "Netherlands", a2: "NL", locale: "nl-NL", regime: "eu-gdpr", tenant: "emea" },
  { country: "Czech Republic", a2: "CZ", locale: "cs-CZ", regime: "eu-gdpr", tenant: "emea" },
  { country: "Romania", a2: "RO", locale: "ro-RO", regime: "eu-gdpr", tenant: "emea" },
  { country: "Slovakia", a2: "SK", locale: "sk-SK", regime: "eu-gdpr", tenant: "emea" },
  { country: "United Kingdom", a2: "GB", locale: "en-GB", regime: "uk-gdpr", tenant: "emea" },
  { country: "Switzerland", a2: "CH", locale: "fr-CH", regime: "ch-fadp", tenant: "emea" },
  { country: "Turkey", a2: "TR", locale: "tr-TR", regime: "tr-kvkk", tenant: "emea" },
  { country: "Israel", a2: "IL", locale: "he-IL", regime: "il-privacy", tenant: "emea" },
  { country: "Morocco", a2: "MA", locale: "ar-MA", regime: "ma-0908", tenant: "emea" },
  { country: "United Arab Emirates", a2: "AE", locale: "en-AE", regime: "ae-pdpl", tenant: "emea" },

  // ---- APAC (hosted Australia) ----
  { country: "Australia", a2: "AU", locale: "en-AU", regime: "au-privacy", tenant: "apac" },
  { country: "New Zealand", a2: "NZ", locale: "en-NZ", regime: "nz-privacy", tenant: "apac" },
  { country: "South Korea", a2: "KR", locale: "ko-KR", regime: "kr-pipa", tenant: "apac" },
  { country: "Singapore", a2: "SG", locale: "zh-SG", regime: "sg-pdpa", tenant: "apac" },
  { country: "Malaysia", a2: "MY", locale: "ms-MY", regime: "my-pdpa", tenant: "apac" },
  { country: "Thailand", a2: "TH", locale: "th-TH", regime: "th-pdpa", tenant: "apac" },
  { country: "Taiwan", a2: "TW", locale: "zh-TW", regime: "tw-pdpa", tenant: "apac" },
  { country: "Indonesia", a2: "ID", locale: "id-ID", regime: "id-pdp", tenant: "apac" },
  { country: "India", a2: "IN", locale: "en-IN", regime: "in-dpdp", tenant: "apac" },

  // ---- Japan (hosted Japan) ----
  { country: "Japan", a2: "JP", locale: "ja-JP", regime: "jp-appi", tenant: "japan" },

  // ---- China (special, out of model) ----
  { country: "China", a2: "CN", locale: "zh-Hans", regime: "cn-pipl", tenant: "china" },
]

// ---------------------------------------------------------------------------
// Tenants (the optimized proposal)
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string
  name: string
  /** The Okta hosting region this tenant's data lives in. */
  hosting: HostingRegionId
  /** Special = handled outside the standard global footprint (China). */
  special?: boolean
  /** Why these markets sit together legally — the privacy rationale. */
  privacy: string
  /** Why these markets sit together operationally — the proximity rationale. */
  proximity: string
  /** Why this consolidation is the optimization (vs. a tenant per country). */
  optimization: string
  /** Future reasons we might split a market out into its own tenant. */
  levers: string[]
  /** Representative SBD brand storefronts (each brand × market = one app). */
  brands: string[]
}

/**
 * The proposal: 4 active tenants chosen on privacy + proximity, plus China as a
 * dedicated out-of-model case. Markets live in MARKETS and point back here.
 */
export const TENANTS: Tenant[] = [
  {
    id: "americas",
    name: "Americas",
    hosting: "us",
    privacy:
      "The US has no transfer restriction, and every Latin-American law here permits sending data to the US with standard contractual safeguards. Canada's Quebec Law 25 allows US hosting after a privacy impact assessment.",
    proximity:
      "One tenant for the Western Hemisphere: North and South America under the SBD Americas office, with English, Spanish and Portuguese storefronts.",
    optimization:
      "Most LATAM entity markets have only a few active users a month. Grouping them with the US avoids several near-empty tenants while staying within each country's transfer rules.",
    levers: [
      "Split Canada into its own CA-region tenant if Quebec Law 25 residency pressure grows.",
      "Brazil (LGPD / ANPD) is the LATAM market most likely to warrant its own handling first.",
    ],
    brands: ["DeWalt", "Stanley", "BLACK+DECKER", "Craftsman"],
  },
  {
    id: "emea",
    name: "Europe, Middle East & Africa",
    hosting: "eu",
    privacy:
      "The EU has the strictest rules, so the whole region is hosted in the EU and the EU rules set the bar. The UK and Switzerland are treated as equivalent to the EEA; the Middle East and North African markets can all transfer to the EU as an approved destination or with standard contract clauses.",
    proximity:
      "One EMEA tenant covering the EU/EEA, UK, Switzerland, Turkey, the Middle East and North Africa — SBD's EMEA office, all on the same GDPR-grade baseline.",
    optimization:
      "About two dozen markets, many of them small, share one EU-hosted tenant instead of one per country. The GDPR baseline already meets the strictest members' rules, so the smaller markets can join it without breaking compliance.",
    levers: [
      "Split the UK into its own UK-region tenant if post-Brexit divergence or localization requires it.",
      "Keep Turkey, UAE and Morocco under review — each has its own transfer-authorization step.",
    ],
    brands: ["DeWalt", "Stanley", "BLACK+DECKER"],
  },
  {
    id: "apac",
    name: "Asia-Pacific",
    hosting: "au",
    privacy:
      "Australia is the in-region Okta hosting option for the wider Asia-Pacific. Most APAC laws here permit cross-border transfer where the destination offers comparable protection or contractual safeguards are in place.",
    proximity:
      "One APAC tenant (excluding Japan and China) covering ANZ, Southeast Asia, Korea, Taiwan and India — keeping data in-region for latency and operations.",
    optimization:
      "Nine markets, several of them tiny, share one Australia-hosted tenant instead of one tenant per country across the region.",
    levers: [
      "South Korea (PIPA) needs explicit opt-in for cross-border transfer — candidate for separate handling.",
      "India's DPDP transfer whitelist is still pending — flagged for review once the rules land.",
    ],
    brands: ["DeWalt", "Stanley", "BLACK+DECKER"],
  },
  {
    id: "japan",
    name: "Japan",
    hosting: "jp",
    privacy:
      "Japan's APPI has EU mutual adequacy and clear cross-border rules. A dedicated JP hosting region keeps Japanese customer data in-country.",
    proximity:
      "Japan stands alone: a large market with its own Okta hosting region and its own privacy law (APPI).",
    optimization:
      "Grouping is meant for the many low-usage markets — Japan is not one. Its size, its own region, and APPI rules make a separate tenant the simpler choice.",
    levers: [
      "Could move into the APAC (Australia) tenant if usage ever drops; Japanese data may be hosted in Australia as long as it gets comparable protection.",
    ],
    brands: ["DeWalt", "Stanley", "BLACK+DECKER"],
  },
  {
    id: "china",
    name: "China",
    hosting: "us", // placeholder — see note: NOT served by the global footprint
    special: true,
    privacy:
      "China's privacy and data laws (PIPL and related laws) require user data to stay in China, and sending any data abroad needs a government approval or a special contract. None of Okta's six hosting regions is in China.",
    proximity:
      "China can't share a tenant with any other market, because its data is not allowed to leave the country under the standard setup.",
    optimization:
      "Handled on its own, outside the standard regions: it needs a login provider inside China or a government-approved way to move data, reviewed separately. Chinese user data is never sent through the standard cross-border setup.",
    levers: [
      "Needs its own China review before any build starts.",
    ],
    brands: ["DeWalt", "Stanley"],
  },
]

/**
 * The proof of concept as it exists TODAY: a single application inside a single
 * demo tenant. Everything in TENANTS above is the target to grow into.
 */
export const CURRENT_POC = {
  tenant: "stanley-black-decker-consumer",
  app: "SBD Sign-In Experience POC",
  hosting: "us" as HostingRegionId,
  note: "One demo application in one demo tenant — the validated starting point.",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Markets assigned to a tenant, in declaration order. */
export function marketsForTenant(tenantId: string): Market[] {
  return MARKETS.filter((m) => m.tenant === tenantId)
}

/** Unique privacy regimes a tenant spans, as regime objects. */
export function regimesForTenant(tenantId: string): PrivacyRegime[] {
  const ids = new Set(marketsForTenant(tenantId).map((m) => m.regime))
  return Array.from(ids).map((id) => PRIVACY_REGIMES[id])
}

/** Active (non-excluded) tenants, including the special China case. */
export const ACTIVE_TENANTS = TENANTS

/** Count of standard (non-special) tenants. */
export function standardTenantCount(): number {
  return TENANTS.filter((t) => !t.special).length
}

/** Total supported entity markets. */
export function totalMarkets(): number {
  return MARKETS.length
}

// ---------------------------------------------------------------------------
// Region routing (wiring the proposal: a live regional-tenant switcher)
// ---------------------------------------------------------------------------
//
// The model above is the target. These exports make it *operational*: the app
// can route real Auth0 logins to a per-region tenant, chosen by the region
// switcher in the header. Until dedicated per-region Auth0 apps are configured,
// every region falls back to the single shared POC app (see lib/auth0-regions.ts),
// so the switcher works end-to-end today and only the backing tenant changes
// once the region-specific env vars are filled in.

/** Cookie that stores the visitor's selected auth region (read by the proxy). */
export const REGION_COOKIE = "sbd_region"

/** The region a visitor lands in before they pick one. */
export const DEFAULT_AUTH_REGION = "americas"

/**
 * Tenants that can actually back a sign-in, in switcher display order. China is
 * included because it is a real (if special) destination; the proxy still routes
 * to it, it simply falls back to the shared app until a China-compliant tenant
 * is wired up.
 */
export const AUTH_REGION_ORDER = ["americas", "emea", "apac", "japan", "china"]

/** Look up a tenant by id. */
export function tenantById(id: string): Tenant | undefined {
  return TENANTS.find((t) => t.id === id)
}

/** Whether the given id is a tenant we can route an auth request to. */
export function isValidAuthRegion(id: string | null | undefined): boolean {
  return Boolean(id && AUTH_REGION_ORDER.includes(id))
}
