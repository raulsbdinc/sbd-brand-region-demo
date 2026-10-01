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

/** Whether a market enforces brand+region enrollment before a session is
 *  usable. Every live Model 4 storefront (FR, DE, UK) does: Google or a
 *  passcode can never open a brand the account holds no password for. */
export function brandAccessEnforced(market: string): boolean {
  return market === "fr" || market === "de" || market === "uk"
}

/** EU only: the EU tenant has no native database OTP on the brand connections,
 *  so an enrolled customer's passcode is sent on the passwordless connection as
 *  mailbox proof. UK keeps its native brand-connection database challenge. */
export function brandPasscodeUsesMailboxProof(market: string): boolean {
  // Neither the EU nor the UK tenant delivers native database OTP on the brand
  // connections; a native challenge there fails silently (swallowed for
  // anti-enumeration) and no code ever reaches the inbox. Every enforced market
  // therefore proves the mailbox via the passwordless email connection, then
  // verify re-resolves the this-brand canonical before stamping a session.
  return market === "fr" || market === "de" || market === "uk"
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
