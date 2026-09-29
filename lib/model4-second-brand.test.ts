// End-to-end proof of UK Model 4 (per-brand) second-brand enrollment in BOTH
// signup orders, driven through the same pure planners + executors the routes
// use, against a fake tenant that behaves like Auth0: linking merges the new
// identity into the SAME root, and passwords are checked per connection.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  executeBrandRegistration,
  executeBrandLink,
  executePerEmailRegistration,
  type ManagementDeps,
} from "./model-registration.ts"
import {
  brandProofMethodAllowed,
  planBrandSignupForExistingAccount,
  unverifiedBrandAccountMessage,
  planModel4CrossBrandLink,
} from "./account-model.ts"
import {
  resolveCredential,
  type ConnectionKey,
  type CredentialBinding,
} from "./credential-model.ts"
import { interpretBrandSignupResponse } from "./drawer-signup.ts"
import type { Auth0User } from "./auth0-management.ts"
import type { BrandId } from "./types"

const NAMES: Record<ConnectionKey, string | undefined> = {
  shared: "sbd-eu",
  "per-email": "sbd-demo-per-email",
  dewalt: "sbd-demo-dewalt",
  stanley: "sbd-demo-stanley",
}
const CONFIGURED = new Set<ConnectionKey>(["shared", "per-email", "dewalt", "stanley"])
const KEY_BY_NAME = new Map(
  Object.entries(NAMES).map(([k, n]) => [n as string, k as ConnectionKey]),
)
const STANLEY_PW = "Stanley-Strong-Pass-1"
const DEWALT_PW = "Dewalt-Different-Pass-2"

function makeTenant() {
  const users = new Map<string, Auth0User>()
  const passwords = new Map<string, string>()
  let seq = 0
  const log = { created: [] as string[], linked: [] as string[] }

  const deps: ManagementDeps = {
    async createUser({ connection, email, password, emailVerified }) {
      const id = `auth0|u${++seq}`
      const user: Auth0User = {
        user_id: id,
        email,
        email_verified: emailVerified,
        identities: [{ connection, provider: "auth0", user_id: id.slice(6) }],
        app_metadata: {},
      }
      users.set(id, user)
      passwords.set(`${connection}|${email}`, password)
      log.created.push(id)
      return user
    },
    async deleteUser(id) {
      users.delete(id)
      return null
    },
    async getUser(id) {
      const u = users.get(id)
      if (!u) throw new Error("not found")
      return u
    },
    async getUsersByEmail(email) {
      return [...users.values()].filter((u) => u.email === email)
    },
    async linkIdentity(primaryId, body) {
      const secondaryId = `auth0|${(body as { user_id: string }).user_id}`
      const primary = users.get(primaryId)!
      const secondary = users.get(secondaryId)!
      primary.identities = [...(primary.identities ?? []), ...(secondary.identities ?? [])]
      users.delete(secondaryId)
      log.linked.push(secondaryId)
      return [] as never
    },
    async unlinkIdentity() {
      return [] as never
    },
    async updateUser(id, body) {
      const u = users.get(id)!
      u.app_metadata = { ...(body.app_metadata ?? {}) }
      return u
    },
  }

  function bindingsOf(u: Auth0User): CredentialBinding[] {
    return ((u.app_metadata as { credential_bindings?: CredentialBinding[] })
      ?.credential_bindings ?? [])
  }

  /** Storefront password sign-in: route by the resolver, then check that realm. */
  function signIn(site: BrandId, email: string, password: string): string | null {
    const root = [...users.values()].find((u) => u.email === email)
    if (!root) return null
    const res = resolveCredential({
      email,
      siteBrand: site,
      bindings: bindingsOf(root),
      identities: (root.identities ?? []).map((i) => ({
        connectionKey: KEY_BY_NAME.get(i.connection) ?? null,
        userId: i.user_id,
      })),
      configuredKeys: CONFIGURED,
      sharedMatch: false,
    })
    if (!res.ok || res.kind !== "resolved") return null
    const realm = NAMES[res.connectionKey]!
    return passwords.get(`${realm}|${email}`) === password ? root.user_id : null
  }

  return { deps, users, log, bindingsOf, signIn }
}

async function registerBrand(t: ReturnType<typeof makeTenant>, brand: "dewalt" | "stanley", email: string, password: string) {
  const out = await executeBrandRegistration(
    { connectionKey: brand, connectionName: NAMES[brand]!, email, password, brand },
    t.deps,
  )
  assert.equal(out.ok, true)
  return out.ok ? out.primaryUserId : ""
}

/** The /api/registration/brand → proof → link sequence for a second brand. */
async function addSecondBrand(
  t: ReturnType<typeof makeTenant>,
  site: "dewalt" | "stanley",
  email: string,
  password: string,
) {
  const [root] = await t.deps.getUsersByEmail(email)
  // Mirrors collectAccountVerifiedEmails: the root email counts only when verified.
  const verifiedEmails = root.email_verified ? [email] : []
  const decision = planBrandSignupForExistingAccount({
    connectionKey: site,
    email,
    account: { bindings: t.bindingsOf(root), verifiedEmails },
  })
  if (decision.kind !== "proof-required") return { decision }

  // What the drawer does with the route's 200 proof-required body: go to the
  // ownership-code step and email a code.
  const drawer = interpretBrandSignupResponse({
    httpStatus: 200,
    body: { status: "proof-required", proofOptions: decision.proofOptions },
  })
  assert.deepEqual(drawer, { kind: "proof-required", canEmailCode: true })
  assert.equal(brandProofMethodAllowed(decision.proofOptions, "email-code"), true)

  // The emailed code was consumed at the IdP → proofVerified.
  const plan = planModel4CrossBrandLink({
    market: "uk",
    siteBrand: site,
    email,
    existingAccount: { auth0UserId: root.user_id, bindings: t.bindingsOf(root) },
    proofVerified: true,
    ownershipEmailVerified: true,
    connectionNames: NAMES,
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) return { decision }
  const out = await executeBrandLink(
    {
      primaryUserId: plan.primaryUserId,
      connectionKey: plan.connectionKey as "dewalt" | "stanley",
      connectionName: plan.connectionName,
      email,
      password,
      brand: site,
    },
    t.deps,
  )
  return { decision, out }
}

/** Simulates the first brand's existing confirmation link → root email_verified=true. */
function confirmEmail(t: ReturnType<typeof makeTenant>, rootId: string) {
  const root = t.users.get(rootId)!
  t.users.set(rootId, { ...root, email_verified: true })
}

for (const [first, second, firstPw, secondPw] of [
  ["stanley", "dewalt", STANLEY_PW, DEWALT_PW],
  ["dewalt", "stanley", DEWALT_PW, STANLEY_PW],
] as const) {
  test(`Model 4 ${first}-first UNVERIFIED → ${second}: refused with verification guidance, no link, no second root`, async () => {
    const t = makeTenant()
    const email = `m4-unverified-${first === "stanley" ? "a" : "b"}@example.com`
    const rootId = await registerBrand(t, first, email, firstPw)
    assert.equal(t.users.get(rootId)!.email_verified, false)

    const { decision, out } = await addSecondBrand(t, second, email, secondPw)
    assert.equal(decision.kind, "verification-required")
    assert.equal(out, undefined)
    assert.equal(t.users.size, 1)
    assert.deepEqual(t.bindingsOf(t.users.get(rootId)!).map((b) => b.connectionKey), [first])
    assert.equal(t.signIn(second, email, secondPw), null)
    assert.match(unverifiedBrandAccountMessage(), /confirm/i)
  })

  test(`Model 4 ${first}-first → ${second}: OTP proof links ${second} to the SAME root; each password only on its brand`, async () => {
    const t = makeTenant()
    const email = `m4-${first}first@example.com`
    const rootId = await registerBrand(t, first, email, firstPw)
    confirmEmail(t, rootId)

    const { decision, out } = await addSecondBrand(t, second, email, secondPw)
    assert.equal(decision.kind, "proof-required")
    assert.equal(out?.ok, true)
    if (out?.ok) assert.equal(out.primaryUserId, rootId)

    // One root, two brand identities, two per-brand bindings, nothing overwritten.
    assert.equal(t.users.size, 1)
    const root = t.users.get(rootId)!
    assert.deepEqual(
      (root.identities ?? []).map((i) => i.connection).sort(),
      [NAMES.dewalt, NAMES.stanley].sort(),
    )
    const bindings = t.bindingsOf(root)
    assert.deepEqual(bindings.map((b) => b.connectionKey).sort(), ["dewalt", "stanley"])
    assert.ok(bindings.every((b) => b.useCase === "per-brand-password"))

    // Each brand password signs into its own brand and returns the same root…
    assert.equal(t.signIn(first, email, firstPw), rootId)
    assert.equal(t.signIn(second, email, secondPw), rootId)
    // …and fails on the other brand.
    assert.equal(t.signIn(first, email, secondPw), null)
    assert.equal(t.signIn(second, email, firstPw), null)
  })

  test(`Model 4 ${first}-first: repeating ${second} enrollment is refused, never a second credential`, async () => {
    const t = makeTenant()
    const email = `m4-repeat-${first === "stanley" ? "a" : "b"}@example.com`
    confirmEmail(t, await registerBrand(t, first, email, firstPw))
    await addSecondBrand(t, second, email, secondPw)
    const again = await addSecondBrand(t, second, email, "Another-Strong-Pass-3")
    assert.equal(again.decision.kind, "already-brand")
    assert.equal(t.users.size, 1)
    assert.equal(t.bindingsOf([...t.users.values()][0]).length, 2)
  })
}

test("cross-model: per-email (Model 3) root + Model 4 signup fails closed with model-mismatch, no writes", async () => {
  const t = makeTenant()
  const email = "sbdciam-dewaltfirst@example.com"
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: NAMES["per-email"]!,
      identities: [{ email, password: DEWALT_PW, role: "primary", emailVerified: true }],
    },
    t.deps,
  )
  assert.equal(out.ok, true)
  const before = t.log.created.length
  const { decision, out: link } = await addSecondBrand(t, "stanley", email, STANLEY_PW)
  assert.deepEqual(decision, { kind: "model-mismatch", existingModel: "per-email" })
  assert.equal(link, undefined)
  assert.equal(t.log.created.length, before)
  // The linker independently refuses too (defence in depth).
  const [root] = await t.deps.getUsersByEmail(email)
  const plan = planModel4CrossBrandLink({
    market: "uk",
    siteBrand: "stanley",
    email,
    existingAccount: { auth0UserId: root.user_id, bindings: t.bindingsOf(root) },
    proofVerified: true,
    ownershipEmailVerified: true,
    connectionNames: NAMES,
  })
  assert.deepEqual(plan, { ok: false, reason: "model-conflict" })
})

test("proof gate: email-code is rejected unless the route offered it; password is always allowed", () => {
  assert.equal(brandProofMethodAllowed(undefined, "email-code"), false)
  assert.equal(brandProofMethodAllowed(["password"], "email-code"), false)
  assert.equal(brandProofMethodAllowed(["password"], "password"), true)
})
