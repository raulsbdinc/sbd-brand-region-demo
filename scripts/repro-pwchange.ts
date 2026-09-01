import {
  resolveConnectionNames,
  configuredConnectionKeys,
  connectionKeyForName,
  sanitizeCredentialBindings,
  type LinkedDbIdentity,
} from "../lib/credential-model.ts"
import { resolvePasswordChangeTarget } from "../lib/password-change.ts"

// Mirror production env: a configured dewalt connection.
const env = {
  ...process.env,
  AUTH0_DEWALT_CONNECTION: "sbd-dewalt",
  AUTH0_STANLEY_CONNECTION: "sbd-stanley",
  AUTH0_PER_EMAIL_CONNECTION: "sbd-per-email",
} as Record<string, string | undefined>

const names = resolveConnectionNames(env)
const configuredKeys = configuredConnectionKeys(names)
console.log("[v0] names:", names)
console.log("[v0] configuredKeys:", [...configuredKeys])

// EXACT live Model 4 shape. Root sub prefixed; binding + identity provider-less.
const rootSub = "auth0|6a97383cec1273ecd6faca5b"
const providerless = "6a97383cec1273ecd6faca5b"

const appMetadata = {
  credential_bindings: [
    {
      id: `dewalt:${providerless}`,
      email: "hodavo5036@prorises.com",
      connectionKey: "dewalt",
      auth0UserId: providerless,
      useCase: "per-brand-password",
      brand: "dewalt",
    },
  ],
}

// Replicate mapIdentities for a few interpretations of the identity array.
function mapIdentities(
  identities: { provider: string; connection: string; user_id: string }[],
): LinkedDbIdentity[] {
  return identities
    .filter((id) => id.provider === "auth0")
    .map((id) => ({
      connectionKey: connectionKeyForName(id.connection, names),
      userId: id.user_id,
    }))
}

const bindings = sanitizeCredentialBindings(appMetadata.credential_bindings)
console.log("[v0] sanitized bindings:", bindings)

function run(
  label: string,
  identities: { provider: string; connection: string; user_id: string }[],
) {
  const mapped = mapIdentities(identities)
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: `dewalt:${providerless}` },
    bindings,
    identities: mapped,
    configuredKeys,
    rootEmail: "hodavo5036@prorises.com",
  })
  console.log(`\n[v0] === ${label} ===`)
  console.log("[v0] mapped identities:", mapped)
  console.log("[v0] resolution:", JSON.stringify(res))
}

// Interpretation A: dewalt is the PRIMARY (connection = dewalt), single identity.
run("A: primary is dewalt", [
  { provider: "auth0", connection: "sbd-dewalt", user_id: providerless },
])

// Interpretation B: primary sbd-eu, linked dewalt with SAME provider-less id.
run("B: primary sbd-eu + linked dewalt (same id portion)", [
  { provider: "auth0", connection: "sbd-eu", user_id: providerless },
  { provider: "auth0", connection: "sbd-dewalt", user_id: providerless },
])

// Interpretation C: identity user_id carries the FULL prefix (auth0|...).
run("C: identity user_id prefixed (auth0|...)", [
  { provider: "auth0", connection: "sbd-dewalt", user_id: rootSub },
])

// Interpretation D: binding.auth0UserId prefixed but identity provider-less.
{
  const prefixedBindings = sanitizeCredentialBindings([
    {
      id: `dewalt:${providerless}`,
      email: "hodavo5036@prorises.com",
      connectionKey: "dewalt",
      auth0UserId: rootSub,
      useCase: "per-brand-password",
      brand: "dewalt",
    },
  ])
  const mapped = mapIdentities([
    { provider: "auth0", connection: "sbd-dewalt", user_id: providerless },
  ])
  const res = resolvePasswordChangeTarget({
    selector: { bindingId: `dewalt:${providerless}` },
    bindings: prefixedBindings,
    identities: mapped,
    configuredKeys,
    rootEmail: "hodavo5036@prorises.com",
  })
  console.log("\n[v0] === D: binding.auth0UserId prefixed, identity provider-less ===")
  console.log("[v0] bindings:", prefixedBindings)
  console.log("[v0] mapped identities:", mapped)
  console.log("[v0] resolution:", JSON.stringify(res))
}
