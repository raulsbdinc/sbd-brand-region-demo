import type { BrandId, CountryId } from "./types"

export interface Brand {
  id: BrandId
  /** Display name used in copy. */
  name: string
  /** Logo wordmark text (brand switching changes this + colors only). */
  wordmark: string
  /** Short tagline describing the brand's tool category, factual. */
  category: string
  /** CSS custom property values applied to the app root. */
  vars: Record<string, string>
}

/**
 * Brand skins. The repo builds several single-brand deployments off one
 * codebase — each Vercel project pins itself to one brand via NEXT_PUBLIC_BRAND
 * (resolved in lib/site.ts). Every brand's tokens, wordmark, and metadata
 * resolve through this record, so the active brand themes the whole app.
 */
export const BRANDS: Record<BrandId, Brand> = {
  dewalt: {
    id: "dewalt",
    name: "DeWalt",
    wordmark: "DEWALT",
    category: "Professional power tools",
    vars: {
      "--brand": "#FEBD17",
      "--brand-foreground": "#1a1a1a",
      "--brand-ink": "#1a1a1a",
      "--brand-ink-foreground": "#fafafa",
      "--brand-surface": "#ffffff",
      "--brand-surface-muted": "#f4f4f5",
      "--brand-border": "#e4e4e7",
      "--brand-foreground-strong": "#18181b",
      "--brand-muted-foreground": "#5c5c66",
      // Sign-in surface facts, measured off the live DeWalt site. Display face
      // is Archivo Expanded (Archivo + wdth, stretched 125% — see app/layout).
      "--brand-display-font": "var(--font-archivo), 'Archivo Fallback', sans-serif",
      "--brand-display-stretch": "125%",
      "--brand-display-case": "uppercase",
      "--brand-display-tracking": "-0.0146em",
      // Measured on dewalt.com — hero/section headings are Archivo Expanded 900.
      "--brand-display-weight": "900",
      "--brand-heading-size": "24px",
      "--brand-heading-line": "28px",
      "--brand-button-radius": "0px",
      "--brand-button-size": "12px",
      "--brand-input-border": "#d7d5d5",
      "--brand-label-color": "#231e20",
      "--brand-label-muted": "#646062",
      "--brand-description-color": "#413d3f",
      "--brand-button-text": "#231e20",
      // Wordmark chip: the values DeWalt already resolved to via --brand /
      // --brand-foreground; named explicitly so no brand relies on a CSS fallback.
      "--brand-wordmark-bg": "#FEBD17",
      "--brand-wordmark-fg": "#1a1a1a",
    },
  },
  craftsman: {
    id: "craftsman",
    name: "Craftsman",
    wordmark: "CRAFTSMAN",
    category: "Trusted tools for every job",
    vars: {
      "--brand": "#D6001C",
      "--brand-foreground": "#ffffff",
      "--brand-ink": "#181a1b",
      "--brand-ink-foreground": "#ffffff",
      "--brand-surface": "#ffffff",
      "--brand-surface-muted": "#eff5f5",
      "--brand-border": "#ced4d4",
      "--brand-foreground-strong": "#181a1b",
      "--brand-muted-foreground": "#768084",
      // Sign-in surface facts, measured off the live Craftsman site.
      // NOTE: Craftsman's real display face is GT America, which is commercially
      // licensed and unavailable to us — this substitutes Inter. It is NOT the
      // real Craftsman typeface; do not mistake it for GT America.
      "--brand-display-font": "var(--font-inter), 'Inter Fallback', sans-serif",
      "--brand-display-stretch": "normal",
      "--brand-display-case": "none",
      "--brand-display-tracking": "-0.0034em",
      // Not deployed; Inter stands in for GT America. 800 keeps the stand-in
      // close to its current font-extrabold headings.
      "--brand-display-weight": "800",
      "--brand-heading-size": "30px",
      "--brand-heading-line": "34px",
      "--brand-button-radius": "9999px",
      "--brand-button-size": "14px",
      "--brand-input-border": "#ced4d4",
      "--brand-label-color": "#181a1b",
      "--brand-label-muted": "#768084",
      "--brand-description-color": "#53585a",
      "--brand-button-text": "#ffffff",
      // Wordmark chip: the values Craftsman already resolved to via --brand /
      // --brand-foreground; named explicitly so no brand relies on a CSS fallback.
      "--brand-wordmark-bg": "#D6001C",
      "--brand-wordmark-fg": "#ffffff",
    },
  },
  stanley: {
    id: "stanley",
    name: "Stanley",
    wordmark: "STANLEY",
    category: "Hand tools, storage and measuring",
    vars: {
      "--brand": "#FFD20A",
      "--brand-foreground": "#171717",
      // INTENTIONAL, measured off the live Stanley France site: --brand-ink is
      // YELLOW here (not near-black like the other two brands). Stanley inverts
      // DeWalt's lockup — DeWalt is a black bar with a yellow wordmark, Stanley
      // is a yellow bar with a black wordmark. The header reads its background
      // from --brand-ink and its text from --brand-ink-foreground, so this
      // inverts correctly with no header change. Do NOT "fix" these back to black.
      "--brand-ink": "#FFD20A",
      "--brand-ink-foreground": "#171717",
      "--brand-surface": "#ffffff",
      "--brand-surface-muted": "#f5f5f5",
      "--brand-border": "#d4d4d4",
      "--brand-foreground-strong": "#171717",
      "--brand-muted-foreground": "#525252",
      // Sign-in surface facts, measured off the live Stanley site. Display face
      // is Open Sans Condensed Bold (Open Sans + wdth, stretched 75% — see app/layout).
      "--brand-display-font": "var(--font-open-sans), 'Open Sans Fallback', sans-serif",
      "--brand-display-stretch": "75%",
      "--brand-display-case": "uppercase",
      "--brand-display-tracking": "-0.0128em",
      // Measured on stanleyoutillage.fr — headings are Open Sans Condensed Bold (700).
      "--brand-display-weight": "700",
      "--brand-heading-size": "28px",
      "--brand-heading-line": "32px",
      "--brand-button-radius": "4px",
      "--brand-button-size": "16px",
      "--brand-input-border": "#d4d4d4",
      "--brand-label-color": "#171717",
      "--brand-label-muted": "#525252",
      "--brand-description-color": "#404040",
      "--brand-button-text": "#171717",
      "--brand-wordmark-bg": "transparent",
      "--brand-wordmark-fg": "#171717",
    },
  },
}

/** Ordered list of brands the repo can be deployed as. */
export const BRAND_ORDER: BrandId[] = ["dewalt", "craftsman", "stanley"]

export interface Country {
  id: CountryId
  /** Full display name, e.g. "United States". */
  name: string
  /** Two-letter code shown as a compact badge, e.g. "US". */
  code: string
  /** BCP-47 locale used to simulate the regional site, e.g. "en-US". */
  locale: string
  /**
   * The Okta/Auth0 identity region (tenant id from lib/regions.ts) that signs
   * users in for this country. Selecting the country routes real sign-ins to
   * this region's tenant for data residency. Many countries map to one region
   * (e.g. UK/FR/DE all sign in via Europe).
   */
  authRegion: string
  /**
   * Optional per-country Auth0 app override. When set, real sign-ins for this
   * country route to a DEDICATED Auth0 application (its own env vars) instead of
   * the shared region tenant — used for countries that have been split out onto
   * their own app (e.g. Canada → "SBD Signon Experience - Dewalt CA"). The value
   * is the auth route key / env-var suffix (see lib/auth0-regions.ts).
   */
  authKey?: string
}

/**
 * Countries the DeWalt storefront can be served in. Each country maps to the
 * identity region (data-residency tenant) that signs its users in — e.g.
 * "DeWalt UK" signs in against the EMEA tenant. Used for locale preferences;
 * the header switcher itself selects the region directly.
 */
export const COUNTRIES: Record<CountryId, Country> = {
  us: { id: "us", name: "United States", code: "US", locale: "en-US", authRegion: "americas" },
  uk: { id: "uk", name: "United Kingdom", code: "UK", locale: "en-GB", authRegion: "emea" },
  ca: { id: "ca", name: "Canada", code: "CA", locale: "en-CA", authRegion: "americas", authKey: "ca" },
  fr: { id: "fr", name: "France", code: "FR", locale: "fr-FR", authRegion: "emea" },
  de: { id: "de", name: "Germany", code: "DE", locale: "de-DE", authRegion: "emea" },
  au: { id: "au", name: "Australia", code: "AU", locale: "en-AU", authRegion: "apac" },
}

/** Ordered list of countries, for rendering switchers. */
export const COUNTRY_ORDER: CountryId[] = ["us", "uk", "ca", "fr", "de", "au"]

/** The identity region (Auth0 tenant id) that signs users in for a country. */
export function regionForCountry(country: CountryId): string {
  return COUNTRIES[country].authRegion
}

/**
 * The auth ROUTE key that backs sign-ins for a country: a per-country app
 * override when one exists (e.g. Canada), otherwise the shared region tenant.
 * This is what gets written to the region cookie and dispatched by the proxy.
 */
export function authKeyForCountry(country: CountryId): string {
  return COUNTRIES[country].authKey ?? COUNTRIES[country].authRegion
}

/** Countries that route sign-ins to their own dedicated Auth0 app. */
export const COUNTRY_AUTH_OVERRIDES: CountryId[] = COUNTRY_ORDER.filter(
  (id) => Boolean(COUNTRIES[id].authKey),
)

/** Human-readable tenant label, e.g. "DeWalt · United States". */
export function tenantLabel(brand: BrandId, country: CountryId): string {
  return `${BRANDS[brand].name} · ${COUNTRIES[country].name}`
}
