// CIAM-16 regression (live on PR71/abdb602): the FR/DE drawer said "At least N
// characters. Any mix…" and the browser accepted N lowercase characters, but
// POST /api/registration/brand answered 400 "(historical) At least 3 of: lowercase,
// uppercase…" because the brand executors hardcoded the UK policy. These tests
// drive the SAME server executors the routes call (with a fake Auth0 tenant)
// on the precise minimum-length lowercase case, prove the client gate agrees, and pin the
// route wiring so a route can't silently fall back to the UK rule again.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  executeBrandRegistration,
  executeBrandLink,
  type ManagementDeps,
} from "./model-registration.ts"
import {
  passwordRequirementsText,
  validateRegistrationPassword,
} from "./password-policy.ts"
import { brandRegionNotice } from "./brand-region-notice.ts"
import type { Auth0User } from "./auth0-management.ts"

const EIGHT_VALID = "Maple!ab"
const EIGHT_LOWER = "abcdefgh"
const SEVEN_VALID = "Maple!a"

function fakeTenant() {
  const users = new Map<string, Auth0User>()
  let seq = 0
  const created: { connection: string; email: string; password: string }[] = []
  const deps: ManagementDeps = {
    async createUser({ connection, email, password, emailVerified }) {
      const id = `auth0|e${++seq}`
      const user: Auth0User = {
        user_id: id,
        email,
        email_verified: emailVerified,
        identities: [{ connection, provider: "auth0", user_id: id.slice(6) }],
        app_metadata: {},
      }
      users.set(id, user)
      created.push({ connection, email, password })
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
      const secondaryId = `auth0|${body.user_id}`
      const primary = users.get(primaryId)!
      const secondary = users.get(secondaryId)!
      primary.identities = [...(primary.identities ?? []), ...(secondary.identities ?? [])]
      users.delete(secondaryId)
      return null
    },
    async unlinkIdentity() {
      return null
    },
    async updateUser(id, body) {
      const u = users.get(id)!
      u.app_metadata = { ...(u.app_metadata ?? {}), ...(body.app_metadata ?? {}) }
      return u
    },
  }
  return { deps, created, users }
}

for (const site of [
  { market: "fr", brand: "dewalt", key: "dewalt", conn: "sbd-emea-dewalt" },
  { market: "de", brand: "dewalt", key: "dewalt", conn: "sbd-emea-dewalt" },
  { market: "fr", brand: "stanley", key: "stanley", conn: "sbd-emea-stanley" },
] as const) {
  const label = `${site.brand} ${site.market.toUpperCase()}`

  test(`${label}: guidance, client gate and server create agree on exactly 8 characters with no digit`, async () => {
    assert.equal(
      passwordRequirementsText(site.market),
      "At least 8 characters, with at least one uppercase letter, one lowercase letter and one special character (such as ! @ # ? or %). Numbers are optional.",
    )
    const email = `ciam16-${site.brand}-${site.market}@mailinator.com`
    assert.equal(validateRegistrationPassword(EIGHT_VALID, [email], site.market).ok, true)

    const t = fakeTenant()
    const outcome = await executeBrandRegistration(
      {
        connectionKey: site.key,
        connectionName: site.conn,
        email,
        password: EIGHT_VALID,
        brand: site.brand,
        market: site.market,
      },
      t.deps,
    )
    assert.equal(outcome.ok, true, JSON.stringify(outcome))
    assert.deepEqual(t.created, [{ connection: site.conn, email, password: EIGHT_VALID }])
  })

  test(`${label}: 7 characters is rejected by client AND server with zero tenant writes`, async () => {
    const email = `ciam16-short-${site.brand}-${site.market}@mailinator.com`
    const client = validateRegistrationPassword(SEVEN_VALID, [email], site.market)
    assert.equal(client.ok, false)
    assert.deepEqual(client.failures, ["At least 8 characters"])

    const t = fakeTenant()
    const outcome = await executeBrandRegistration(
      {
        connectionKey: site.key,
        connectionName: site.conn,
        email,
        password: SEVEN_VALID,
        brand: site.brand,
        market: site.market,
      },
      t.deps,
    )
    assert.deepEqual(outcome, { ok: false, status: 400, error: "At least 8 characters." })
    assert.equal(t.created.length, 0)
  })
}

test("FR second-brand link (Stanley under existing DeWalt primary) accepts 8 characters with no digit", async () => {
  const t = fakeTenant()
  const email = "ciam16-link@mailinator.com"
  const first = await executeBrandRegistration(
    { connectionKey: "dewalt", connectionName: "sbd-emea-dewalt", email, password: EIGHT_VALID, brand: "dewalt", market: "fr" },
    t.deps,
  )
  assert.equal(first.ok, true)
  const primaryUserId = (first as { primaryUserId: string }).primaryUserId
  const link = await executeBrandLink(
    { primaryUserId, connectionKey: "stanley", connectionName: "sbd-emea-stanley", email, password: "Zyxw!uts", brand: "stanley", market: "fr" },
    t.deps,
  )
  assert.equal(link.ok, true, JSON.stringify(link))
})

test("8 lowercase only is rejected on UK too (same rule everywhere)", async () => {
  const t = fakeTenant()
  const outcome = await executeBrandRegistration(
    { connectionKey: "dewalt", connectionName: "sbd-demo-dewalt", email: "uk@mailinator.com", password: EIGHT_LOWER, brand: "dewalt", market: "uk" },
    t.deps,
  )
  assert.equal(outcome.ok, false)
  assert.equal(t.created.length, 0)
})

test("brand routes pass the real SITE_MARKET to the executors (no UK fallback)", () => {
  for (const file of ["app/api/registration/brand/route.ts", "app/api/registration/brand/proof/route.ts"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.match(src, /market: SITE_MARKET,\s*\},\s*realManagementDeps/, file)
  }
  const add = readFileSync(new URL("../app/api/account/passwords/route.ts", import.meta.url), "utf8")
  assert.match(add, /validateRegistrationPassword\(password, \[\], SITE_MARKET\)/)
})

test("FR/DE and UK drawer notices use Model 4 brand/region wording", () => {
  for (const m of ["fr", "de"]) {
    const text = brandRegionNotice(m)
    assert.match(text, /DeWalt France and DeWalt Germany/)
    assert.match(text, /Stanley needs its own sign-up and password/)
    assert.match(text, /UK sites are a separate region/)
    assert.doesNotMatch(text, /One Stanley Black & Decker account/)
  }
  const uk = brandRegionNotice("uk", "dewalt")
  assert.doesNotMatch(uk, /One Stanley Black & Decker account/)
  assert.match(uk, /DeWalt UK\. Stanley needs its own sign-up and password/)
  assert.match(uk, /France and Germany sites are a separate region/)
})
