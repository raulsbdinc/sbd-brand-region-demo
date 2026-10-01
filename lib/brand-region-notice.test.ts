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

test("uk/other markets keep the existing shared-account copy", () => {
  assert.match(accountExistsNotice("uk"), /One account works across DeWalt, Stanley/)
  assert.match(brandRegionNotice("uk"), /works across DeWalt, Stanley/)
})

test("wiring: drawer uses the market-aware exists copy, no hardcoded cross-brand claim", () => {
  const drawer = readFileSync(new URL("../components/sign-in-drawer.tsx", import.meta.url), "utf8")
  assert.match(drawer, /accountExistsNotice\(SITE_MARKET\)/)
  assert.doesNotMatch(drawer, /"You may already have a Stanley Black & Decker account/)
})
