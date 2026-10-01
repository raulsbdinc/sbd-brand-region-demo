import { test } from "node:test"
import assert from "node:assert/strict"
import { selectPasswordVerifier, verifierEnvKeys } from "./password-verifier.ts"
import { resolvePasswordChangeTarget } from "./password-change.ts"
import type {
  ConnectionKey,
  CredentialBinding,
} from "./credential-model.ts"

const DW_FR = { clientId: "dw-fr-client", clientSecret: "dw-fr-secret" }
const ST_FR = { clientId: "st-fr-client", clientSecret: "st-fr-secret" }

// Simulated tenant: each client enables ONLY its own brand connection, exactly
// like the real storefront apps. A grant succeeds only if the client can reach
// the target connection AND the password matches.
const CLIENT_CONNECTIONS: Record<string, ConnectionKey[]> = {
  [DW_FR.clientId]: ["dewalt"],
  [ST_FR.clientId]: ["stanley"],
}
const PASSWORDS: Record<string, string> = {
  dewalt: "silvermeadowway",
  stanley: "velvetstonewalk",
}

const KEYS = new Set<ConnectionKey>(["dewalt", "stanley"])
const CANONICAL = "auth0|6abec5271375bdc8341c8aa9"
const EMAIL = "customer@example.com"

const bindings: CredentialBinding[] = [
  { id: "dw-1", email: EMAIL, connectionKey: "dewalt", auth0UserId: CANONICAL, useCase: "per-brand-password", brand: "dewalt" },
  { id: "st-1", email: EMAIL, connectionKey: "stanley", auth0UserId: "auth0|st-secondary", useCase: "per-brand-password", brand: "stanley" },
]
const identities = [
  { connectionKey: "dewalt" as ConnectionKey, userId: CANONICAL },
  { connectionKey: "stanley" as ConnectionKey, userId: "auth0|st-secondary" },
]

function makeExchange() {
  const calls: { clientId: string; realm: ConnectionKey }[] = []
  const exchange = (clientId: string, realm: ConnectionKey, password: string) => {
    calls.push({ clientId, realm })
    return (CLIENT_CONNECTIONS[clientId] ?? []).includes(realm) && PASSWORDS[realm] === password
  }
  return { calls, exchange }
}

/** Mirrors the route: resolve owned target → select verifier → verify → (would PATCH). */
function changePassword(opts: {
  siteBrand: "dewalt" | "stanley"
  storefront: typeof DW_FR
  env: Record<string, string | undefined>
  bindingId: string
  current: string
  accountBindings?: CredentialBinding[]
  accountIdentities?: typeof identities
}) {
  const { calls, exchange } = makeExchange()
  const patches: string[] = []
  const resolution = resolvePasswordChangeTarget({
    selector: { bindingId: opts.bindingId },
    bindings: opts.accountBindings ?? bindings,
    identities: opts.accountIdentities ?? identities,
    configuredKeys: KEYS,
    rootEmail: EMAIL,
    rootUserId: CANONICAL,
  })
  if (!resolution.ok) return { status: 404, calls, patches }
  const target = resolution.target
  const verifier = selectPasswordVerifier({
    targetConnectionKey: target.connectionKey,
    siteBrand: opts.siteBrand,
    storefront: opts.storefront,
    env: opts.env,
  })
  if (!verifier) return { status: 503, calls, patches }
  if (!exchange(verifier.clientId, target.connectionKey, opts.current)) {
    return { status: 401, calls, patches }
  }
  patches.push(`${target.managementUserId}:${target.connectionKey}`)
  return { status: 200, calls, patches, target }
}

const ON_DEWALT_ENV = {
  [verifierEnvKeys("stanley").clientId]: ST_FR.clientId,
  [verifierEnvKeys("stanley").clientSecret]: ST_FR.clientSecret,
}
const ON_STANLEY_ENV = {
  [verifierEnvKeys("dewalt").clientId]: DW_FR.clientId,
  [verifierEnvKeys("dewalt").clientSecret]: DW_FR.clientSecret,
}

test("REPRO: storefront client cannot verify another brand's password (the 401 bug)", () => {
  const { exchange } = makeExchange()
  assert.equal(exchange(DW_FR.clientId, "stanley", "velvetstonewalk"), false)
  assert.equal(exchange(ST_FR.clientId, "dewalt", "silvermeadowway"), false)
})

test("Change Stanley from DeWalt FR: verified with Stanley verifier, PATCHes Stanley on canonical", () => {
  const r = changePassword({ siteBrand: "dewalt", storefront: DW_FR, env: ON_DEWALT_ENV, bindingId: "st-1", current: "velvetstonewalk" })
  assert.equal(r.status, 200)
  assert.deepEqual(r.calls, [{ clientId: ST_FR.clientId, realm: "stanley" }])
  assert.deepEqual(r.patches, [`${CANONICAL}:stanley`])
})

test("Change DeWalt from Stanley FR: verified with DeWalt verifier, PATCHes DeWalt on canonical", () => {
  const r = changePassword({ siteBrand: "stanley", storefront: ST_FR, env: ON_STANLEY_ENV, bindingId: "dw-1", current: "silvermeadowway" })
  assert.equal(r.status, 200)
  assert.deepEqual(r.calls, [{ clientId: DW_FR.clientId, realm: "dewalt" }])
  assert.deepEqual(r.patches, [`${CANONICAL}:dewalt`])
})

test("same-brand change keeps using the storefront client", () => {
  const r = changePassword({ siteBrand: "dewalt", storefront: DW_FR, env: {}, bindingId: "dw-1", current: "silvermeadowway" })
  assert.equal(r.status, 200)
  assert.deepEqual(r.calls, [{ clientId: DW_FR.clientId, realm: "dewalt" }])
})

test("wrong current password is denied in both cross-brand directions, no PATCH", () => {
  const a = changePassword({ siteBrand: "dewalt", storefront: DW_FR, env: ON_DEWALT_ENV, bindingId: "st-1", current: "wrong-pass-123" })
  const b = changePassword({ siteBrand: "stanley", storefront: ST_FR, env: ON_STANLEY_ENV, bindingId: "dw-1", current: "wrong-pass-123" })
  assert.equal(a.status, 401)
  assert.equal(b.status, 401)
  assert.deepEqual([...a.patches, ...b.patches], [])
})

test("other brand's password cannot be used as the target's current password", () => {
  const r = changePassword({ siteBrand: "dewalt", storefront: DW_FR, env: ON_DEWALT_ENV, bindingId: "st-1", current: "silvermeadowway" })
  assert.equal(r.status, 401)
  assert.deepEqual(r.patches, [])
})

test("foreign binding (identity not on this account) fails before any verification", () => {
  const foreign: CredentialBinding = { id: "st-x", email: EMAIL, connectionKey: "stanley", auth0UserId: "auth0|someone-else", useCase: "per-brand-password", brand: "stanley" }
  const r = changePassword({
    siteBrand: "dewalt", storefront: DW_FR, env: ON_DEWALT_ENV, bindingId: "st-x", current: "velvetstonewalk",
    accountBindings: [bindings[0], foreign],
  })
  assert.equal(r.status, 404)
  assert.deepEqual(r.calls, [])
  assert.deepEqual(r.patches, [])
})

test("missing target verifier env fails closed (503), never falls back to the storefront client", () => {
  const r = changePassword({ siteBrand: "dewalt", storefront: DW_FR, env: {}, bindingId: "st-1", current: "velvetstonewalk" })
  assert.equal(r.status, 503)
  assert.deepEqual(r.calls, [])
})

test("verifier equal to the storefront client is rejected as misconfigured", () => {
  const env = { [verifierEnvKeys("stanley").clientId]: DW_FR.clientId, [verifierEnvKeys("stanley").clientSecret]: DW_FR.clientSecret }
  assert.equal(selectPasswordVerifier({ targetConnectionKey: "stanley", siteBrand: "dewalt", storefront: DW_FR, env }), null)
})

test("non-brand targets (shared / per-email / unknown) never get a verifier", () => {
  for (const key of ["shared", "per-email", "craftsman", ""]) {
    assert.equal(selectPasswordVerifier({ targetConnectionKey: key, siteBrand: "dewalt", storefront: DW_FR, env: ON_DEWALT_ENV }), null)
  }
})
