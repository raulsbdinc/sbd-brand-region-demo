// CURRENT-PASSWORD VERIFIER SELECTION (pure, framework-free)
// ==========================================================
// The password-realm grant only succeeds when the CLIENT used has the target
// database connection enabled. Each storefront client deliberately enables only
// its own brand connection, so verifying a DIFFERENT brand's owned password
// (e.g. "Change Stanley password" on a DeWalt storefront) must use that TARGET
// brand's own existing app credentials — never a broadened storefront client.
//
// Rules:
//   • Target credential on the storefront's own brand → the storefront client.
//   • Target on another allow-listed brand → AUTH0_VERIFIER_<BRAND>_CLIENT_ID /
//     _SECRET (same region tenant; server-only env). Missing → null (fail closed).
//   • Any other key (shared / per-email / unknown) → null. Model 4 only.

export type VerifierBrand = "dewalt" | "stanley"

const VERIFIER_BRANDS: readonly VerifierBrand[] = ["dewalt", "stanley"]

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

export function isVerifierBrand(key: string): key is VerifierBrand {
  return (VERIFIER_BRANDS as readonly string[]).includes(key)
}

export function verifierEnvKeys(brand: VerifierBrand) {
  const upper = brand.toUpperCase()
  return {
    clientId: `AUTH0_VERIFIER_${upper}_CLIENT_ID`,
    clientSecret: `AUTH0_VERIFIER_${upper}_CLIENT_SECRET`,
  }
}

export function selectPasswordVerifier(params: {
  targetConnectionKey: string
  siteBrand: string
  storefront: Partial<ClientCredentials>
  env: Record<string, string | undefined>
}): ClientCredentials | null {
  const { targetConnectionKey, siteBrand, storefront, env } = params
  if (!isVerifierBrand(targetConnectionKey)) return null

  if (targetConnectionKey === siteBrand) {
    if (!storefront.clientId || !storefront.clientSecret) return null
    return { clientId: storefront.clientId, clientSecret: storefront.clientSecret }
  }

  const keys = verifierEnvKeys(targetConnectionKey)
  const clientId = env[keys.clientId]?.trim()
  const clientSecret = env[keys.clientSecret]?.trim()
  if (!clientId || !clientSecret) return null
  // A verifier equal to the storefront client cannot reach the other brand's
  // connection; treat it as misconfigured rather than silently failing as 401.
  if (clientId === storefront.clientId) return null
  return { clientId, clientSecret }
}
