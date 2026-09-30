import { test } from "node:test"
import assert from "node:assert/strict"

import {
  brandPasswordActionLabel,
  brandPasswordScopeLine,
  isProfileBrand,
  planBrandPasswordRows,
  profileBrandName,
  profilePasswordModelVisibility,
  type BrandPasswordRow,
} from "./brand-password-actions.ts"

// --- profilePasswordModelVisibility: one model per UK storefront ------------

test("flag on: DeWalt UK exposes Model 3 (per-email) only", () => {
  const v = profilePasswordModelVisibility({ market: "uk", brand: "dewalt", perEmailEnabled: true })
  assert.deepEqual(v, { perEmail: true, perBrand: false })
})

test("Stanley UK exposes Model 4 (per-brand) only", () => {
  const v = profilePasswordModelVisibility({ market: "uk", brand: "stanley" })
  assert.deepEqual(v, { perEmail: false, perBrand: true })
})

test("EU storefronts expose NEITHER model (single Account password)", () => {
  for (const market of ["fr", "de"] as const) {
    for (const brand of ["dewalt", "stanley"] as const) {
      const v = profilePasswordModelVisibility({ market, brand })
      assert.deepEqual(
        v,
        { perEmail: false, perBrand: false },
        `${brand} ${market} must show neither per-email nor per-brand controls`,
      )
    }
  }
})

test("a brand without a per-brand connection never gets per-brand controls", () => {
  const v = profilePasswordModelVisibility({ market: "uk", brand: "craftsman" })
  assert.deepEqual(v, { perEmail: false, perBrand: false })
})

// --- labels + scope always name the exact brand -----------------------------

test("action labels name the exact brand and set/change state", () => {
  assert.equal(brandPasswordActionLabel("set", "Stanley"), "Set Stanley password")
  assert.equal(brandPasswordActionLabel("change", "Stanley"), "Change Stanley password")
  assert.equal(brandPasswordActionLabel("set", "DeWalt"), "Set DeWalt password")
  assert.equal(brandPasswordActionLabel("change", "DeWalt"), "Change DeWalt password")
})

test("scope line names the brand and promises the other brand is unaffected", () => {
  const line = brandPasswordScopeLine("Stanley")
  assert.match(line, /Stanley/)
  assert.match(line, /other brand password is unaffected/)
})

test("profileBrandName / isProfileBrand", () => {
  assert.equal(profileBrandName("dewalt"), "DeWalt")
  assert.equal(profileBrandName("stanley"), "Stanley")
  assert.equal(isProfileBrand("dewalt"), true)
  assert.equal(isProfileBrand("stanley"), true)
  assert.equal(isProfileBrand("craftsman"), false)
  assert.equal(isProfileBrand(null), false)
})

// --- planBrandPasswordRows --------------------------------------------------

function byBrand(rows: BrandPasswordRow[]) {
  return new Map(rows.map((r) => [r.brand, r]))
}

test("off Model 4 → no rows, even with credentials present", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: false,
    deploymentBrand: "stanley",
    existingBrandCredentials: ["stanley", "dewalt"],
    thisBrandProvisionable: true,
  })
  assert.deepEqual(rows, [])
})

test("Stanley UK, fresh account: only a 'Set Stanley password' row (no DeWalt row)", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "stanley",
    existingBrandCredentials: [],
    thisBrandProvisionable: true,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].brand, "stanley")
  assert.equal(rows[0].kind, "set")
  assert.equal(rows[0].label, "Set Stanley password")
})

test("Stanley UK with a Stanley credential: 'Change Stanley password'", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "stanley",
    existingBrandCredentials: ["stanley"],
    thisBrandProvisionable: false,
  })
  const map = byBrand(rows)
  assert.equal(map.get("stanley")?.kind, "change")
  assert.equal(map.get("stanley")?.label, "Change Stanley password")
  // No DeWalt row — DeWalt can't be set from the Stanley storefront.
  assert.equal(map.has("dewalt"), false)
})

test("Stanley UK with BOTH credentials: change rows for both, deployment brand first", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "stanley",
    existingBrandCredentials: ["dewalt", "stanley"],
    thisBrandProvisionable: false,
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].brand, "stanley", "deployment brand comes first")
  assert.equal(rows[1].brand, "dewalt")
  assert.equal(rows[0].kind, "change")
  assert.equal(rows[1].kind, "change")
  assert.equal(rows[0].label, "Change Stanley password")
  assert.equal(rows[1].label, "Change DeWalt password")
})

test("Stanley UK, Stanley set + existing DeWalt: set Stanley (first) + change DeWalt", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "stanley",
    existingBrandCredentials: ["dewalt"],
    thisBrandProvisionable: true,
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].brand, "stanley")
  assert.equal(rows[0].kind, "set")
  assert.equal(rows[1].brand, "dewalt")
  assert.equal(rows[1].kind, "change")
})

test("deployment brand NOT provisionable and no credential → no set row", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "stanley",
    existingBrandCredentials: [],
    thisBrandProvisionable: false,
  })
  assert.deepEqual(rows, [])
})

test("existing credential wins over provisionable (change, never a duplicate set)", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "stanley",
    existingBrandCredentials: ["stanley"],
    thisBrandProvisionable: true,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, "change")
})

test("DeWalt-brand per-brand storefront mirrors the labels for DeWalt first", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "dewalt",
    existingBrandCredentials: ["stanley"],
    thisBrandProvisionable: true,
  })
  assert.equal(rows[0].brand, "dewalt")
  assert.equal(rows[0].label, "Set DeWalt password")
  assert.equal(rows[1].brand, "stanley")
  assert.equal(rows[1].label, "Change Stanley password")
})

test("unknown deployment brand (craftsman) → no rows", () => {
  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand: "craftsman",
    existingBrandCredentials: [],
    thisBrandProvisionable: true,
  })
  assert.deepEqual(rows, [])
})
