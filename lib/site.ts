// PER-DEPLOYMENT IDENTITY
// =======================
// One repo builds several Vercel projects that differ ONLY by their env vars:
// each project is pinned to a single brand, market, and Auth0 database
// connection. This module resolves that fixed identity from the environment
// once, so the rest of the app can read constants instead of hardcoding DeWalt.
//
// Next.js only inlines a NEXT_PUBLIC_ var into the client bundle when the
// property is written out LITERALLY (e.g. `process.env.NEXT_PUBLIC_BRAND`);
// a computed key like `process.env[name]` is never replaced and reads back
// undefined in the browser. That's why each var is spelled out in full below.

import { BRANDS, COUNTRIES, tenantLabel } from "./brands"
import type { Brand, Country } from "./brands"
import type { BrandId, CountryId } from "./types"

const FALLBACK_BRAND: BrandId = "dewalt"
const FALLBACK_MARKET: CountryId = "fr"
const FALLBACK_CONNECTION = "Username-Password-Authentication"

function resolveBrand(): BrandId {
  const raw = process.env.NEXT_PUBLIC_BRAND?.trim().toLowerCase()
  if (raw && raw in BRANDS) return raw as BrandId
  return FALLBACK_BRAND
}

function resolveMarket(): CountryId {
  const raw = process.env.NEXT_PUBLIC_MARKET?.trim().toLowerCase()
  if (raw && raw in COUNTRIES) return raw as CountryId
  return FALLBACK_MARKET
}

function resolveConnection(): string {
  const raw = process.env.NEXT_PUBLIC_AUTH0_CONNECTION?.trim()
  return raw || FALLBACK_CONNECTION
}

/** The single brand this deployment is built as. */
export const SITE_BRAND: BrandId = resolveBrand()

/** The single market (country) this deployment serves. */
export const SITE_MARKET: CountryId = resolveMarket()

/** The Auth0 database connection that backs this deployment's password sign-in. */
export const SITE_CONNECTION: string = resolveConnection()

// STOREFRONT IDENTITY (derived)
// =============================
// The storefront shell reads as one brand in one market. Every piece of that
// identity is derived from SITE_BRAND / SITE_MARKET here — nothing downstream
// hardcodes "DeWalt" or "France", so the single build serves all three sites.

/** The full brand record for this deployment (wordmark, colours, category). */
export const SITE_BRAND_INFO: Brand = BRANDS[SITE_BRAND]

/** The full country record for this deployment (name, code, locale). */
export const SITE_COUNTRY: Country = COUNTRIES[SITE_MARKET]

/** Human label for this deployment, e.g. "DeWalt · France". */
export const SITE_TENANT_LABEL: string = tenantLabel(SITE_BRAND, SITE_MARKET)

/**
 * Prices are shown in euros for every market this repo serves (France and
 * Germany are both eurozone). Formatting is locale-driven so the same amount
 * subtly reads for its market (e.g. "149 €") without translating the copy.
 */
export function formatPrice(amount: number, market: CountryId = SITE_MARKET): string {
  return new Intl.NumberFormat(COUNTRIES[market].locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount)
}

export interface StorefrontContent {
  /** Small eyebrow above the hero headline, e.g. category · market. */
  eyebrow: string
  /** Hero headline, written in the brand's voice with the market named. */
  headline: string
  /** Hero supporting paragraph. */
  subcopy: string
  /** One-line brand promise used in the footer. */
  footerTagline: string
  /** Footer market line, e.g. "Serving Germany · Prices shown in euros (€)". */
  marketLine: string
}

// Per-brand storefront voice. This is a brand-fact table exactly like BRANDS —
// it is parameterised by brand id (never a single hardcoded brand) and the
// market name is injected, so both the brand AND the market change the copy.
// Keep the copy in English for every market; the audience is English-speaking
// and legibility beats authenticity here.
const BRAND_VOICE: Record<BrandId, Omit<StorefrontContent, "eyebrow" | "marketLine">> = {
  dewalt: {
    headline: "Professional-grade power, built for {market}.",
    subcopy:
      "Explore the cordless lineup trusted on jobsites across {market}, with pricing shown for your region.",
    footerTagline: "Tools engineered for the professional jobsite.",
  },
  craftsman: {
    headline: "Dependable tools for every project in {market}.",
    subcopy:
      "Discover the Craftsman range built for pros and homeowners across {market}, priced for your region.",
    footerTagline: "Reliable tools for every job around the home and beyond.",
  },
}

/**
 * Resolve the storefront copy for any brand + market combination. Pure and
 * dependency-free so it can be unit-checked for every combination the repo
 * ships as, independent of which env this build was compiled with.
 */
export function storefrontContent(
  brand: BrandId,
  market: CountryId,
): StorefrontContent {
  const voice = BRAND_VOICE[brand]
  const marketName = COUNTRIES[market].name
  const fill = (s: string) => s.replaceAll("{market}", marketName)
  return {
    eyebrow: `${BRANDS[brand].category} · ${marketName}`,
    headline: fill(voice.headline),
    subcopy: fill(voice.subcopy),
    footerTagline: voice.footerTagline,
    marketLine: `Serving ${marketName} · Prices shown in euros (€)`,
  }
}

/** The resolved storefront copy for this deployment's fixed brand + market. */
export const SITE_CONTENT: StorefrontContent = storefrontContent(
  SITE_BRAND,
  SITE_MARKET,
)

// Header category nav, chosen per brand (a brand-fact table like BRAND_VOICE,
// never hardcoded to one brand). These are plausible top-level departments for
// each brand's catalogue — enough to read as a real storefront to an executive
// audience, replacing the old "For Position Only" placeholder.
const BRAND_NAV: Record<BrandId, string[]> = {
  dewalt: ["Power Tools", "Hand Tools", "Accessories", "Storage"],
  craftsman: ["Power Tools", "Hand Tools", "Lawn & Garden", "Tool Storage"],
}

/** The header category list for this deployment's brand. */
export const SITE_NAV: string[] = BRAND_NAV[SITE_BRAND]
