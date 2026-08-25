"use strict"

const assert = require("node:assert/strict")
const { describe, it } = require("node:test")
const { onExecutePostLogin, _test } = require("./add-sbd-claims.js")

const IDENTITY_NAMESPACE = "https://sbd.com"
const OTHER_SITES_CLAIM = "https://sbd.demo/other_sites"

// A real demo client id (DeWalt France) and its site id, from the Action's map.
const DEWALT_FR_CLIENT = "BGDDy2XQqKEoHkjCaHcDyddwEB3yM1Va"
const DEWALT_DE_CLIENT = "nucmPspqRd7fh8m77mvhx0VipdIx9zyP"
const STANLEY_FR_CLIENT = "3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI"

function actionApi() {
  const idClaims = {}
  const accessClaims = {}
  const appMetadata = {}
  // Record every api.user write, and trip a flag if any linking / Management-style
  // mutation is ever attempted (none should exist).
  const forbiddenCalls = []
  const forbid = (name) => (...args) => forbiddenCalls.push({ name, args })

  return {
    idClaims,
    accessClaims,
    appMetadata,
    forbiddenCalls,
    api: {
      idToken: { setCustomClaim: (key, value) => { idClaims[key] = value } },
      accessToken: { setCustomClaim: (key, value) => { accessClaims[key] = value } },
      user: {
        setAppMetadata: (key, value) => { appMetadata[key] = value },
        // The following would indicate account linking / ownership inference.
        // They must never be invoked by this Action.
        setUserMetadata: forbid("setUserMetadata"),
        link: forbid("link"),
        setPrimaryUser: forbid("setPrimaryUser"),
      },
    },
  }
}

function demoEvent(overrides = {}) {
  return {
    client: { client_id: DEWALT_FR_CLIENT },
    user: { user_id: "auth0|abc123", app_metadata: { roles: ["customer", "product-owner"], muid: "muid_123" } },
    authentication: { methods: [{ name: "pwd" }] },
    connection: { strategy: "auth0" },
    resource_server: { identifier: "https://api.sbd.com" },
    secrets: { SBD_API_AUDIENCE: "https://api.sbd.com" },
    ...overrides,
  }
}

describe("SBD custom claims Action — scoping", () => {
  it("does no work at all for a non-demo client", async () => {
    const { api, idClaims, accessClaims, appMetadata, forbiddenCalls } = actionApi()
    await onExecutePostLogin(demoEvent({ client: { client_id: "some-other-ciam-app" } }), api)

    assert.deepEqual(idClaims, {})
    assert.deepEqual(accessClaims, {})
    assert.deepEqual(appMetadata, {})
    assert.deepEqual(forbiddenCalls, [])
  })

  it("does no work when the client id is missing", async () => {
    const { api, idClaims, accessClaims, appMetadata } = actionApi()
    await onExecutePostLogin(demoEvent({ client: {} }), api)
    assert.deepEqual(idClaims, {})
    assert.deepEqual(accessClaims, {})
    assert.deepEqual(appMetadata, {})
  })

  it("recognises all three demo client ids", () => {
    assert.equal(_test.resolveDemoSite({ client: { client_id: DEWALT_FR_CLIENT } }).id, "dewalt-fr")
    assert.equal(_test.resolveDemoSite({ client: { client_id: DEWALT_DE_CLIENT } }).id, "dewalt-de")
    assert.equal(_test.resolveDemoSite({ client: { client_id: STANLEY_FR_CLIENT } }).id, "stanley-fr")
    assert.equal(_test.resolveDemoSite({ client: { client_id: "nope" } }), null)
  })
})

describe("SBD custom claims Action — no linking / no Management", () => {
  it("never invokes any linking or ownership-mutating api and only writes sbd_sites", async () => {
    const { api, appMetadata, forbiddenCalls } = actionApi()
    await onExecutePostLogin(demoEvent(), api)

    assert.deepEqual(forbiddenCalls, [])
    assert.deepEqual(Object.keys(appMetadata), ["sbd_sites"])
  })

  it("does not throw when the api has no user.setAppMetadata (older api shape)", async () => {
    const idClaims = {}
    const api = {
      idToken: { setCustomClaim: (k, v) => { idClaims[k] = v } },
      accessToken: { setCustomClaim: () => {} },
    }
    await onExecutePostLogin(demoEvent(), api)
    // Claims still emitted; the metadata write is simply skipped.
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/muid`], "muid_123")
    assert.deepEqual(idClaims[OTHER_SITES_CLAIM], [])
  })
})

describe("SBD custom claims Action — identity + authorization", () => {
  it("puts identity context in the ID token and authorization in an approved API token", async () => {
    const { api, idClaims, accessClaims } = actionApi()
    await onExecutePostLogin(demoEvent(), api)

    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/muid`], "muid_123")
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/auth_method`], "pwd")
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/idp`], "auth0")
    assert.deepEqual(idClaims[OTHER_SITES_CLAIM], [])
    assert.deepEqual(accessClaims, {
      [`${IDENTITY_NAMESPACE}/roles`]: ["customer", "product-owner"],
      [`${IDENTITY_NAMESPACE}/muid`]: "muid_123",
    })
  })

  it("does not add authorization claims for a different audience", async () => {
    const { api, accessClaims } = actionApi()
    await onExecutePostLogin(
      demoEvent({ resource_server: { identifier: "https://other.example/api" } }),
      api,
    )
    assert.deepEqual(accessClaims, {})
  })

  it("does not add authorization claims when the audience secret is missing", async () => {
    const { api, accessClaims } = actionApi()
    await onExecutePostLogin(demoEvent({ secrets: {} }), api)
    assert.deepEqual(accessClaims, {})
  })

  it("normalizes, deduplicates, validates, and bounds roles", () => {
    const values = ["customer", " Customer ", "admin", "bad role!", 42]
    for (let index = 0; index < 30; index += 1) values.push(`role-${index}`)
    const roles = _test.normalizeRoles(values)

    assert.equal(roles.length, 20)
    assert.deepEqual(roles.slice(0, 2), ["customer", "admin"])
    assert.equal(roles.includes("bad role!"), false)
  })

  it("falls back to the trusted user_id for muid when app_metadata.muid is absent", async () => {
    const { api, idClaims, accessClaims } = actionApi()
    await onExecutePostLogin(
      demoEvent({ user: { user_id: "auth0|6a70d2138df7fe04e81e6c61", app_metadata: { roles: ["customer"] } } }),
      api,
    )
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/muid`], "auth0|6a70d2138df7fe04e81e6c61")
    assert.equal(accessClaims[`${IDENTITY_NAMESPACE}/muid`], "auth0|6a70d2138df7fe04e81e6c61")
  })

  it("resolveMuid prefers metadata, then user_id, tolerating the pipe and rejecting junk", () => {
    assert.equal(_test.resolveMuid({ user: { app_metadata: { muid: "muid_9" }, user_id: "auth0|x" } }), "muid_9")
    assert.equal(_test.resolveMuid({ user: { app_metadata: {}, user_id: "auth0|x" } }), "auth0|x")
    assert.equal(_test.resolveMuid({ user: { app_metadata: { muid: "bad muid!" }, user_id: "auth0|y" } }), "auth0|y")
    assert.equal(_test.resolveMuid({ user: {} }), null)
  })
})

describe("SBD custom claims Action — cross-site recognition", () => {
  it("emits other demo sites most-recent-first, excluding the current site", async () => {
    const { api, idClaims } = actionApi()
    await onExecutePostLogin(
      demoEvent({
        client: { client_id: DEWALT_DE_CLIENT }, // current site = dewalt-de
        user: {
          user_id: "auth0|abc123",
          app_metadata: {
            sbd_sites: {
              "dewalt-fr": "2025-08-01T10:00:00.000Z",
              "stanley-fr": "2025-08-03T10:00:00.000Z",
              "dewalt-de": "2025-07-01T10:00:00.000Z", // current, must be excluded
            },
          },
        },
      }),
      api,
    )

    assert.deepEqual(idClaims[OTHER_SITES_CLAIM], [
      { id: "stanley-fr", label: "Stanley France", lastSignIn: "2025-08-03T10:00:00.000Z" },
      { id: "dewalt-fr", label: "DeWalt France", lastSignIn: "2025-08-01T10:00:00.000Z" },
    ])
  })

  it("updates sbd_sites with the current site while preserving prior entries", async () => {
    const { api, appMetadata } = actionApi()
    const before = Date.now()
    await onExecutePostLogin(
      demoEvent({
        client: { client_id: STANLEY_FR_CLIENT }, // current site = stanley-fr
        user: {
          user_id: "auth0|abc123",
          app_metadata: { sbd_sites: { "dewalt-fr": "2025-08-01T10:00:00.000Z" } },
        },
      }),
      api,
    )

    const written = appMetadata.sbd_sites
    assert.equal(written["dewalt-fr"], "2025-08-01T10:00:00.000Z") // preserved
    assert.equal(typeof written["stanley-fr"], "string") // current site stamped
    const stamped = Date.parse(written["stanley-fr"])
    assert.equal(Number.isNaN(stamped), false)
    assert.ok(stamped >= before) // a fresh ISO timestamp
  })

  it("emits an empty array on the account's first demo site", async () => {
    const { api, idClaims } = actionApi()
    await onExecutePostLogin(
      demoEvent({ user: { user_id: "auth0|abc123", app_metadata: {} } }),
      api,
    )
    assert.deepEqual(idClaims[OTHER_SITES_CLAIM], [])
  })

  it("buildOtherSites ignores unknown site ids and sorts undated entries last", () => {
    const sites = {
      "dewalt-fr": "2025-08-01T00:00:00.000Z",
      "unknown-site": "2025-12-01T00:00:00.000Z", // not a known demo site -> ignored
      "stanley-fr": null, // no timestamp -> sorts last
    }
    const out = _test.buildOtherSites(sites, "dewalt-de")
    assert.deepEqual(
      out.map((s) => s.id),
      ["dewalt-fr", "stanley-fr"],
    )
    assert.equal(out.find((s) => s.id === "stanley-fr").lastSignIn, null)
  })

  it("nextSbdSites stamps the current site and drops non-string legacy values", () => {
    const next = _test.nextSbdSites(
      { "dewalt-fr": "2025-08-01T00:00:00.000Z", "bogus": null },
      "dewalt-de",
      "2025-08-05T00:00:00.000Z",
    )
    assert.deepEqual(next, {
      "dewalt-fr": "2025-08-01T00:00:00.000Z",
      "dewalt-de": "2025-08-05T00:00:00.000Z",
    })
  })
})

describe("SBD custom claims Action — chosen display email", () => {
  it("overrides the ID-token email and email_verified from a valid primary_email", async () => {
    const { api, idClaims } = actionApi()
    await onExecutePostLogin(
      demoEvent({
        user: { user_id: "auth0|abc123", app_metadata: { primary_email: "chosen@example.com" } },
      }),
      api,
    )
    assert.equal(idClaims.email, "chosen@example.com")
    assert.equal(idClaims.email_verified, true)
  })

  it("does not override email when primary_email is missing or malformed", async () => {
    for (const primary of [undefined, "", "not-an-email", "two@@at.com", "has space@example.com", 42]) {
      const { api, idClaims } = actionApi()
      await onExecutePostLogin(
        demoEvent({ user: { user_id: "auth0|abc123", app_metadata: { primary_email: primary } } }),
        api,
      )
      assert.equal("email" in idClaims, false, `primary_email=${String(primary)} should not set email`)
      assert.equal("email_verified" in idClaims, false)
    }
  })
})

describe("SBD custom claims Action — fail-safe on malformed / optional fields", () => {
  it("omits malformed identity metadata instead of minting or persisting defaults", async () => {
    const { api, idClaims, accessClaims } = actionApi()
    await onExecutePostLogin(
      demoEvent({ user: { user_id: "auth0|abc123", app_metadata: { roles: "admin", muid: "not valid!" } } }),
      api,
    )
    // muid falls back to the trusted user_id; auth_method/idp still present.
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/muid`], "auth0|abc123")
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/auth_method`], "pwd")
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/idp`], "auth0")
    // roles was not an array -> no roles claim on the access token.
    assert.equal(accessClaims[`${IDENTITY_NAMESPACE}/roles`], undefined)
  })

  it("tolerates a malformed sbd_sites (array or string) as empty history", async () => {
    for (const bad of [[], "nope", 42, null]) {
      const { api, idClaims, appMetadata } = actionApi()
      await onExecutePostLogin(
        demoEvent({ user: { user_id: "auth0|abc123", app_metadata: { sbd_sites: bad } } }),
        api,
      )
      assert.deepEqual(idClaims[OTHER_SITES_CLAIM], [])
      // The current site is still recorded from a clean slate.
      assert.equal(typeof appMetadata.sbd_sites["dewalt-fr"], "string")
    }
  })

  it("fails safely when optional event fields are absent (non-demo client → nothing)", async () => {
    const { api, idClaims, accessClaims, appMetadata } = actionApi()
    await onExecutePostLogin({}, api)
    assert.deepEqual(idClaims, {})
    assert.deepEqual(accessClaims, {})
    assert.deepEqual(appMetadata, {})
  })

  it("emits only what is valid for a demo login missing authentication/connection", async () => {
    const { api, idClaims } = actionApi()
    await onExecutePostLogin(
      { client: { client_id: DEWALT_FR_CLIENT }, user: { user_id: "auth0|abc123", app_metadata: {} } },
      api,
    )
    assert.equal(idClaims[`${IDENTITY_NAMESPACE}/muid`], "auth0|abc123")
    assert.equal(`${IDENTITY_NAMESPACE}/auth_method` in idClaims, false)
    assert.equal(`${IDENTITY_NAMESPACE}/idp` in idClaims, false)
    assert.deepEqual(idClaims[OTHER_SITES_CLAIM], [])
  })
})
