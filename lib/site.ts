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

import { BRANDS, COUNTRIES } from "./brands"
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
