import { test } from "node:test"
import assert from "node:assert/strict"

import { effectiveMarket, previewOverrideAllowed } from "./preview-market.ts"

test("previewOverrideAllowed: only production forbids overrides", () => {
  assert.equal(previewOverrideAllowed("production"), false)
  assert.equal(previewOverrideAllowed("preview"), true)
  assert.equal(previewOverrideAllowed("development"), true)
  assert.equal(previewOverrideAllowed(undefined), true)
  assert.equal(previewOverrideAllowed(null), true)
})

test("effectiveMarket: honors a valid override when allowed", () => {
  const r = effectiveMarket({ siteMarket: "fr", override: "uk", allowOverride: true })
  assert.deepEqual(r, { market: "uk", overridden: true })
})

test("effectiveMarket: case-insensitive + trims the override", () => {
  const r = effectiveMarket({ siteMarket: "fr", override: "  UK ", allowOverride: true })
  assert.deepEqual(r, { market: "uk", overridden: true })
})

test("effectiveMarket: ignores override when not allowed (production)", () => {
  const r = effectiveMarket({ siteMarket: "fr", override: "uk", allowOverride: false })
  assert.deepEqual(r, { market: "fr", overridden: false })
})

test("effectiveMarket: ignores unknown / malformed override", () => {
  for (const bad of ["", "zz", "england", "u k", "123"]) {
    const r = effectiveMarket({ siteMarket: "fr", override: bad, allowOverride: true })
    assert.deepEqual(r, { market: "fr", overridden: false }, `override=${JSON.stringify(bad)}`)
  }
})

test("effectiveMarket: a no-op override equal to the site market is not an override", () => {
  const r = effectiveMarket({ siteMarket: "uk", override: "uk", allowOverride: true })
  assert.deepEqual(r, { market: "uk", overridden: false })
})

test("effectiveMarket: null / missing override falls back to the site market", () => {
  assert.deepEqual(effectiveMarket({ siteMarket: "de", override: null, allowOverride: true }), {
    market: "de",
    overridden: false,
  })
  assert.deepEqual(effectiveMarket({ siteMarket: "de", allowOverride: true }), {
    market: "de",
    overridden: false,
  })
})
