import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { accountExistsNotice, brandRegionNotice } from "./brand-region-notice.ts"

test("fr/de: no copy claims one account works across every brand", () => {
  for (const market of ["fr", "de"]) {
    assert.doesNotMatch(accountExistsNotice(market), /works across|One account/i)
    assert.doesNotMatch(brandRegionNotice(market), /works across DeWalt, Stanley/i)
  }
})

test("uk DeWalt: exact Model 4 brand+region notice", () => {
  assert.equal(
    brandRegionNotice("uk", "dewalt"),
    "Your DeWalt email and password work on DeWalt UK. Stanley needs its own sign-up and password. France and Germany sites are a separate region with their own accounts.",
  )
})

test("uk Stanley: exact Model 4 notice with brands swapped", () => {
  assert.equal(
    brandRegionNotice("uk", "stanley"),
    "Your Stanley email and password work on Stanley UK. DeWalt needs its own sign-up and password. France and Germany sites are a separate region with their own accounts.",
  )
})

test("fr Stanley: notice names Stanley France and DeWalt as separate", () => {
  const n = brandRegionNotice("fr", "stanley")
  assert.match(n, /Stanley France/)
  assert.match(n, /DeWalt needs its own sign-up and password/)
})

test("no market/brand combination claims one account or password across brands", () => {
  for (const market of ["fr", "de", "uk", undefined]) {
    for (const brand of ["dewalt", "stanley", undefined]) {
      for (const copy of [brandRegionNotice(market, brand), accountExistsNotice(market, brand)]) {
        assert.doesNotMatch(copy, /works across|One account|one password|sign in separately/i)
      }
    }
  }
})

test("fr/de notice states DeWalt FR/DE shared, Stanley separate, UK separate", () => {
  for (const market of ["fr", "de"]) {
    const notice = brandRegionNotice(market)
    assert.match(notice, /DeWalt France and DeWalt Germany/)
    assert.match(notice, /Stanley needs its own sign-up and password/)
    assert.match(notice, /UK sites are a separate region/)
  }
})

test("wiring: direct /recover lands in the drawer's recovery mode", () => {
  const page = readFileSync(new URL("../app/recover/page.tsx", import.meta.url), "utf8")
  assert.match(page, /buildDrawerRedirect\(\{ mode: "recover" \}\)/)
  assert.doesNotMatch(page, /RecoveryCenter/)
})

test("wiring: drawer renders the market notice once, for every step incl. recovery", () => {
  const drawer = readFileSync(new URL("../components/sign-in-drawer.tsx", import.meta.url), "utf8")
  const uses = drawer.match(/\{brandRegionNotice\(SITE_MARKET, SITE_BRAND\)\}/g) ?? []
  assert.equal(uses.length, 1)
  assert.match(drawer, /"Reset your password"/)
})

test("wiring: drawer uses the market-aware exists copy, no hardcoded cross-brand claim", () => {
  const drawer = readFileSync(new URL("../components/sign-in-drawer.tsx", import.meta.url), "utf8")
  assert.match(drawer, /accountExistsNotice\(SITE_MARKET, SITE_BRAND\)/)
  assert.doesNotMatch(drawer, /"You may already have a Stanley Black & Decker account/)
})
