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
 * Brand skin. The POC is locked to DeWalt, so there is a single brand whose
 * tokens theme the whole app. Kept as a record (not inlined) so the wordmark,
 * theme tokens, and metadata preference all keep resolving through one path.
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
    },
  },
}

/** Ordered list of brands. The POC ships a single brand: DeWalt. */
export const BRAND_ORDER: BrandId[] = ["dewalt"]

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
