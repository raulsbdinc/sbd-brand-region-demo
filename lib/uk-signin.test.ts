import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildUkSignInTarget,
  isUkSignInOptionId,
  safeReturnTo,
  ukOptionConnectionKey,
  ukSignInOptions,
  UK_SIGNIN_OPTION_IDS,
} from "./uk-signin.ts"
import type { ConnectionKey } from "./credential-model.ts"

// A fully-configured connection-name map, with a DISTINCT name per key so a
// test can prove the right one was chosen (never the shared default by
// accident — that misrouting is the exact live bug being fixed).
const NAMES: Record<ConnectionKey, string | undefined> = {
  shared: "sbd-eu",
  "per-email": "sbd-uk-per-email",
  dewalt: "sbd-uk-dewalt",
  stanley: "sbd-uk-stanley",
}

function params(url: string): URLSearchParams {
  const q = url.split("?")[1] ?? ""
  return new URLSearchParams(q)
}

describe("ukSignInOptions", () => {
  it("returns the four options in order, weaving in the brand name", () => {
    const opts = ukSignInOptions("DeWalt")
    assert.deepEqual(
      opts.map((o) => o.id),
      ["shared", "per-email", "brand", "google"],
    )
    const brand = opts.find((o) => o.id === "brand")!
    assert.match(brand.label, /DeWalt/)
    // Only Google skips the email step.
    assert.equal(opts.find((o) => o.id === "google")!.needsEmail, false)
    for (const id of ["shared", "per-email", "brand"] as const) {
      assert.equal(opts.find((o) => o.id === id)!.needsEmail, true)
    }
  })

  it("never leaks a raw Auth0 connection name into a user-facing label", () => {
    const opts = ukSignInOptions("Stanley")
    const leaky = [...Object.values(NAMES), "sbd-eu", "per-email connection"]
    for (const o of opts) {
      for (const name of leaky) {
        assert.ok(
          !o.label.includes(name!) && !o.description.includes(name!),
          `option ${o.id} leaked connection name "${name}"`,
        )
      }
    }
  })
})

describe("isUkSignInOptionId", () => {
  it("accepts the allow-list and rejects everything else", () => {
    for (const id of UK_SIGNIN_OPTION_IDS) assert.ok(isUkSignInOptionId(id))
    for (const bad of ["", "sbd-eu", "dewalt-fr", "SHARED", null, undefined, 3]) {
      assert.equal(isUkSignInOptionId(bad), false)
    }
  })
})

describe("ukOptionConnectionKey", () => {
  it("maps each option to its connection key for the brand", () => {
    assert.equal(ukOptionConnectionKey("shared", "dewalt"), "shared")
    assert.equal(ukOptionConnectionKey("per-email", "stanley"), "per-email")
    assert.equal(ukOptionConnectionKey("brand", "dewalt"), "dewalt")
    assert.equal(ukOptionConnectionKey("brand", "stanley"), "stanley")
    assert.equal(ukOptionConnectionKey("google", "dewalt"), null)
    // A storefront brand with no brand connection key resolves to null.
    assert.equal(ukOptionConnectionKey("brand", "craftsman"), null)
  })
})

describe("safeReturnTo", () => {
  it("keeps same-origin paths", () => {
    assert.equal(safeReturnTo("/account"), "/account")
    assert.equal(safeReturnTo("/account?tab=security"), "/account?tab=security")
  })
  it("rejects cross-origin and malformed values, using the fallback", () => {
    assert.equal(safeReturnTo("//evil.com"), "/profile")
    assert.equal(safeReturnTo("/\\evil.com"), "/profile")
    assert.equal(safeReturnTo("https://evil.com"), "/profile")
    assert.equal(safeReturnTo("javascript:alert(1)"), "/profile")
    assert.equal(safeReturnTo(undefined), "/profile")
    assert.equal(safeReturnTo(null), "/profile")
  })
  it("honours a custom fallback", () => {
    assert.equal(safeReturnTo(null, "/live"), "/live")
  })
})

describe("buildUkSignInTarget — connection selection (the live bug)", () => {
  it("routes a per-email account to the per-email connection, NOT the shared default", () => {
    const t = buildUkSignInTarget({
      optionId: "per-email",
      email: "jane@example.com",
      brand: "dewalt",
      names: NAMES,
    })
    assert.ok(t.ok)
    const p = params(t.url)
    assert.equal(p.get("connection"), "sbd-uk-per-email")
    assert.notEqual(p.get("connection"), "sbd-eu")
    assert.equal(p.get("login_hint"), "jane@example.com")
    assert.equal(p.get("returnTo"), "/profile")
  })

  it("routes the shared option to the shared connection", () => {
    const t = buildUkSignInTarget({
      optionId: "shared",
      email: "jane@example.com",
      brand: "stanley",
      names: NAMES,
    })
    assert.ok(t.ok)
    assert.equal(params(t.url).get("connection"), "sbd-eu")
  })

  it("routes the brand option to the current storefront brand connection", () => {
    const dw = buildUkSignInTarget({
      optionId: "brand",
      email: "jane@example.com",
      brand: "dewalt",
      names: NAMES,
    })
    assert.ok(dw.ok)
    assert.equal(params(dw.url).get("connection"), "sbd-uk-dewalt")

    const st = buildUkSignInTarget({
      optionId: "brand",
      email: "jane@example.com",
      brand: "stanley",
      names: NAMES,
    })
    assert.ok(st.ok)
    assert.equal(params(st.url).get("connection"), "sbd-uk-stanley")
  })

  it("builds the Google target with prompt=login and no email hint", () => {
    const t = buildUkSignInTarget({
      optionId: "google",
      brand: "dewalt",
      names: NAMES,
    })
    assert.ok(t.ok)
    const p = params(t.url)
    assert.equal(p.get("connection"), "google-oauth2")
    assert.equal(p.get("prompt"), "login")
    assert.equal(p.get("login_hint"), null)
    assert.equal(p.get("returnTo"), "/profile")
  })

  it("preserves a safe returnTo and sanitizes an unsafe one", () => {
    const safe = buildUkSignInTarget({
      optionId: "shared",
      email: "jane@example.com",
      returnTo: "/account",
      brand: "dewalt",
      names: NAMES,
    })
    assert.ok(safe.ok)
    assert.equal(params(safe.url).get("returnTo"), "/account")

    const unsafe = buildUkSignInTarget({
      optionId: "shared",
      email: "jane@example.com",
      returnTo: "//evil.com",
      brand: "dewalt",
      names: NAMES,
    })
    assert.ok(unsafe.ok)
    assert.equal(params(unsafe.url).get("returnTo"), "/profile")
  })

  it("requires a valid email for password options", () => {
    for (const email of [undefined, "", "not-an-email"]) {
      const t = buildUkSignInTarget({
        optionId: "per-email",
        email,
        brand: "dewalt",
        names: NAMES,
      })
      assert.equal(t.ok, false)
      if (!t.ok) assert.equal(t.reason, "missing-email")
    }
  })

  it("reports not-configured when the chosen connection has no name", () => {
    const t = buildUkSignInTarget({
      optionId: "per-email",
      email: "jane@example.com",
      brand: "dewalt",
      names: { ...NAMES, "per-email": undefined },
    })
    assert.equal(t.ok, false)
    if (!t.ok) assert.equal(t.reason, "not-configured")
  })

  it("reports invalid-option for a brand option on a storefront without a brand key", () => {
    const t = buildUkSignInTarget({
      optionId: "brand",
      email: "jane@example.com",
      brand: "craftsman",
      names: NAMES,
    })
    assert.equal(t.ok, false)
    if (!t.ok) assert.equal(t.reason, "invalid-option")
  })
})

describe("prompt=login on every chooser option (SSO-bypass fix)", () => {
  // A leftover tenant SSO session must never satisfy an explicit chooser
  // selection: without prompt=login, Auth0 silently returns the previous user
  // instead of requesting the chosen email/credential. Every option that builds
  // an /auth/login URL must therefore force a fresh credential prompt.
  it("sets prompt=login for shared, per-email and per-brand password options", () => {
    const cases: Array<{ optionId: "shared" | "per-email" | "brand"; brand: "dewalt" | "stanley" }> = [
      { optionId: "shared", brand: "dewalt" },
      { optionId: "per-email", brand: "dewalt" },
      { optionId: "brand", brand: "dewalt" },
      { optionId: "brand", brand: "stanley" },
    ]
    for (const c of cases) {
      const t = buildUkSignInTarget({
        optionId: c.optionId,
        email: "jane@example.com",
        brand: c.brand,
        names: NAMES,
      })
      assert.ok(t.ok, `${c.optionId}/${c.brand} should build`)
      assert.equal(
        params(t.url).get("prompt"),
        "login",
        `${c.optionId}/${c.brand} must force a fresh credential prompt`,
      )
    }
  })

  it("sets prompt=login for Google (regression guard)", () => {
    const t = buildUkSignInTarget({ optionId: "google", brand: "stanley", names: NAMES })
    assert.ok(t.ok)
    assert.equal(params(t.url).get("prompt"), "login")
  })

  it("every buildable chooser option carries prompt=login", () => {
    for (const id of UK_SIGNIN_OPTION_IDS) {
      const t = buildUkSignInTarget({
        optionId: id,
        email: "jane@example.com",
        brand: "dewalt",
        names: NAMES,
      })
      assert.ok(t.ok, `${id} should build for a DeWalt storefront`)
      assert.equal(params(t.url).get("prompt"), "login", `${id} missing prompt=login`)
    }
  })
})

describe("success-CTA routing parity", () => {
  it("the Model 3 success CTA reaches the per-email connection with the primary email", () => {
    // Mirrors the direct /api/signin/uk?option=per-email&email=<primary> CTA.
    const t = buildUkSignInTarget({
      optionId: "per-email",
      email: "primary@example.com",
      brand: "dewalt",
      names: NAMES,
    })
    assert.ok(t.ok)
    const p = params(t.url)
    assert.equal(p.get("connection"), "sbd-uk-per-email")
    assert.equal(p.get("login_hint"), "primary@example.com")
  })

  it("the Model 4 success CTA reaches the current brand connection with the email", () => {
    const t = buildUkSignInTarget({
      optionId: "brand",
      email: "shared@example.com",
      brand: "stanley",
      names: NAMES,
    })
    assert.ok(t.ok)
    const p = params(t.url)
    assert.equal(p.get("connection"), "sbd-uk-stanley")
    assert.equal(p.get("login_hint"), "shared@example.com")
  })
})
