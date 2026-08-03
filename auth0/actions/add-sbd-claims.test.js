"use strict"

const assert = require("node:assert/strict")
const { describe, it } = require("node:test")
const { onExecutePostLogin, _test } = require("./add-sbd-claims.js")

const NAMESPACE = "https://sbd.com"

function actionApi() {
  const idClaims = {}
  const accessClaims = {}
  return {
    idClaims,
    accessClaims,
    api: {
      idToken: { setCustomClaim: (key, value) => { idClaims[key] = value } },
      accessToken: { setCustomClaim: (key, value) => { accessClaims[key] = value } },
    },
  }
}

function validEvent(overrides = {}) {
  return {
    user: { app_metadata: { roles: ["customer", "product-owner"], muid: "muid_123" } },
    authentication: { methods: [{ name: "pwd" }] },
    connection: { strategy: "auth0" },
    resource_server: { identifier: "https://api.sbd.com" },
    secrets: { SBD_API_AUDIENCE: "https://api.sbd.com" },
    ...overrides,
  }
}

describe("SBD custom claims Action", () => {
  it("puts identity context in the ID token and authorization in an approved API token", async () => {
    const { api, idClaims, accessClaims } = actionApi()
    await onExecutePostLogin(validEvent(), api)

    assert.deepEqual(idClaims, {
      [`${NAMESPACE}/muid`]: "muid_123",
      [`${NAMESPACE}/auth_method`]: "pwd",
      [`${NAMESPACE}/idp`]: "auth0",
    })
    assert.deepEqual(accessClaims, {
      [`${NAMESPACE}/roles`]: ["customer", "product-owner"],
      [`${NAMESPACE}/muid`]: "muid_123",
    })
  })

  it("does not add authorization claims for a different audience", async () => {
    const { api, accessClaims } = actionApi()
    await onExecutePostLogin(
      validEvent({ resource_server: { identifier: "https://other.example/api" } }),
      api,
    )
    assert.deepEqual(accessClaims, {})
  })

  it("does not add authorization claims when the audience secret is missing", async () => {
    const { api, accessClaims } = actionApi()
    await onExecutePostLogin(validEvent({ secrets: {} }), api)
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

  it("omits malformed metadata instead of minting or persisting defaults", async () => {
    const { api, idClaims, accessClaims } = actionApi()
    await onExecutePostLogin(
      validEvent({ user: { app_metadata: { roles: "admin", muid: "not valid!" } } }),
      api,
    )
    assert.deepEqual(idClaims, {
      [`${NAMESPACE}/auth_method`]: "pwd",
      [`${NAMESPACE}/idp`]: "auth0",
    })
    assert.deepEqual(accessClaims, {})
  })

  it("fails safely when optional event fields are absent", async () => {
    const { api, idClaims, accessClaims } = actionApi()
    await onExecutePostLogin({}, api)
    assert.deepEqual(idClaims, {})
    assert.deepEqual(accessClaims, {})
  })
})
