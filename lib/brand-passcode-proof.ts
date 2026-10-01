// BRAND PASSCODE SIGN-IN — CANONICAL SELECTION (pure, framework-free, tested)
// ===========================================================================
// The EU tenant rejects native database OTP on the brand connections
// ("OTP authentication methods feature is not supported for this connection"),
// so a per-brand (Model 4) customer's passcode is delivered through the existing
// passwordless "email" connection. That code proves MAILBOX OWNERSHIP only — the
// session it would mint belongs to a throwaway email|… identity, never to the
// customer's account. After the code is consumed at the IdP, the server picks
// the ONE canonical account that is enrolled in THIS storefront's brand for the
// typed email, and mints that account's session.
//
// Fails closed (null) unless EXACTLY ONE account:
//   - carries a credential binding for this brand's connection key whose email
//     equals the typed email, AND
//   - actually holds the database identity that binding points at.
// An email match alone is never enough; a binding without its identity, a
// binding on another brand, or two qualifying owners all return null.

export type BrandPasscodeKey = "dewalt" | "stanley"

export interface BrandPasscodeCandidate {
  accountId: string
  bindings: { connectionKey: string; email: string; auth0UserId: string }[]
  identities: { connectionKey: string | null; userId: string }[]
}

export function selectBrandPasscodeAccount(params: {
  email: string
  brandKey: BrandPasscodeKey
  candidates: BrandPasscodeCandidate[]
}): string | null {
  const email = params.email.trim().toLowerCase()
  if (!email) return null

  const owners = new Set<string>()
  for (const c of params.candidates) {
    if (!c.accountId) continue
    const enrolled = c.bindings.some(
      (b) =>
        b.connectionKey === params.brandKey &&
        b.email.trim().toLowerCase() === email &&
        c.identities.some(
          (id) => id.connectionKey === params.brandKey && id.userId === b.auth0UserId,
        ),
    )
    if (enrolled) owners.add(c.accountId)
  }
  return owners.size === 1 ? [...owners][0] : null
}
