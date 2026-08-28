// PREVIEW MARKET RESOLUTION — PURE
// ================================
// SITE_MARKET is fixed per deployment (fr / de today), so the UK-only account-
// model journeys can never be seen on a non-UK preview. For demos we allow a
// `?market=` override to select which market's registration UI renders — but
// ONLY in non-production environments, so production correctness is unchanged.
//
// This is display gating only. The registration API routes independently gate
// on the real SITE_MARKET server-side, so an override lets you WALK the UK
// journeys on a preview while submissions still resolve against the deployment's
// true market (and report "not available / not configured" honestly).

import type { CountryId } from "./types"

const KNOWN_MARKETS: ReadonlySet<CountryId> = new Set<CountryId>([
  "us",
  "uk",
  "ca",
  "fr",
  "de",
  "au",
])

/** Overrides are honored everywhere except production. */
export function previewOverrideAllowed(vercelEnv?: string | null): boolean {
  return vercelEnv !== "production"
}

export interface EffectiveMarket {
  /** The market whose UI should render. */
  market: CountryId
  /** True when a preview override changed the market away from the deployment's. */
  overridden: boolean
}

/**
 * Resolve which market's UI to render. Falls back to the deployment's market
 * for a missing, malformed, unknown, or not-allowed override. A no-op override
 * (equal to the site market) is not treated as an override.
 */
export function effectiveMarket(input: {
  siteMarket: CountryId
  override?: string | null
  allowOverride: boolean
}): EffectiveMarket {
  const { siteMarket, override, allowOverride } = input
  if (allowOverride && typeof override === "string") {
    const candidate = override.trim().toLowerCase()
    if (
      candidate !== siteMarket &&
      KNOWN_MARKETS.has(candidate as CountryId)
    ) {
      return { market: candidate as CountryId, overridden: true }
    }
  }
  return { market: siteMarket, overridden: false }
}
