import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatPrice, marketCurrency, storefrontContent } from "./site.ts"
import type { BrandId, CountryId } from "./types"

// These are pure, market-parameterised helpers, so we can check every market
// the repo can serve regardless of which env this build was compiled with.

describe("marketCurrency", () => {
  it("prices the UK in pounds sterling", () => {
    const c = marketCurrency("uk")
    assert.equal(c.code, "GBP")
    assert.equal(c.symbol, "£")
    assert.equal(c.noun, "pounds")
  })

  it("keeps FR and DE in euros (unchanged)", () => {
    for (const m of ["fr", "de"] as CountryId[]) {
      const c = marketCurrency(m)
      assert.equal(c.code, "EUR")
      assert.equal(c.symbol, "€")
      assert.equal(c.noun, "euros")
    }
  })

  it("resolves a real currency for every market", () => {
    for (const m of ["us", "uk", "ca", "fr", "de", "au"] as CountryId[]) {
      const c = marketCurrency(m)
      assert.match(c.code, /^[A-Z]{3}$/)
      assert.ok(c.symbol.length > 0)
      assert.ok(c.noun.length > 0)
    }
  })
})

describe("formatPrice", () => {
  it("formats UK prices in GBP with the £ symbol", () => {
    const s = formatPrice(149, "uk")
    assert.ok(s.includes("£"), `expected £ in "${s}"`)
    assert.ok(!s.includes("€"), `must not show € in "${s}"`)
    // en-GB GBP renders as "£149" (no fractional digits).
    assert.equal(s, "£149")
  })

  it("formats FR prices in euros (unchanged)", () => {
    const s = formatPrice(149, "fr")
    assert.ok(s.includes("€"), `expected € in "${s}"`)
    assert.ok(!s.includes("£"), `must not show £ in "${s}"`)
  })

  it("formats DE prices in euros (unchanged)", () => {
    const s = formatPrice(149, "de")
    assert.ok(s.includes("€"))
    assert.ok(!s.includes("£"))
  })
})

describe("storefront footer market line", () => {
  it("UK footer names pounds, not euros", () => {
    for (const brand of ["dewalt", "stanley"] as BrandId[]) {
      const { marketLine } = storefrontContent(brand, "uk")
      assert.equal(marketLine, "Serving United Kingdom · Prices shown in pounds (£)")
      assert.ok(!/euro|€/i.test(marketLine), `UK footer leaked euros: "${marketLine}"`)
    }
  })

  it("FR and DE footers still name euros (unchanged)", () => {
    assert.equal(
      storefrontContent("stanley", "fr").marketLine,
      "Serving France · Prices shown in euros (€)",
    )
    assert.equal(
      storefrontContent("dewalt", "de").marketLine,
      "Serving Germany · Prices shown in euros (€)",
    )
  })
})
