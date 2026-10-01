// BRAND ACCESS GATE FOR ALTERNATIVE SIGN-IN ROUTES — PURE
// ======================================================
// On the EU (FR/DE) storefronts each brand has its own password. An emailed
// passcode or a Google sign-in must never grant a brand the customer has not
// enrolled in (for example, a DeWalt-only customer reaching Stanley France).
// These helpers decide, from the real linked identities only, whether a
// canonical account may sign in on this storefront's brand. Legacy shared
// accounts (the old shared connection) keep working and are never converted.

export interface IdentityLike {
  connection?: string
}

/** Whether a market enforces brand enrollment on alternative sign-in routes. */
export function brandAccessEnforced(market: string): boolean {
  return market === "fr" || market === "de"
}

/**
 * True ONLY when the account holds this brand's own password identity (Model 4
 * enrollment). A legacy shared-connection identity grants nothing — there is
 * no grandfathering. Fails closed when no brand connection is configured. The
 * `shared` field is accepted for call-site compatibility and deliberately
 * ignored.
 */
export function identitiesAuthorizeBrand(
  identities: IdentityLike[] | undefined,
  connections: { brand?: string; shared?: string },
): boolean {
  const brand = connections.brand?.trim()
  if (!brand) return false
  return (identities ?? []).some((id) => id.connection === brand)
}
