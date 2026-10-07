import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  BRAND_PENDING_CLAIM,
  BRAND_RECONCILE_PATH,
  BRAND_VERIFIED_CLAIM,
  GOOGLE_LINK_COMPLETE_PATH,
  cookieValue,
  brandSessionUser,
  brandVerifiedUser,
  clearBrandPending,
  decideBrandSessionGate,
  isBrandPending,
  isBrandVerified,
  sessionProbeRequest,
} from "./brand-session-gate.ts"

function signupPost(): Request {
  return new Request("https://sbd-demo-dewalt-fr.vercel.app/api/registration/brand", {
    method: "POST",
    headers: { cookie: "__session=abc; sbd_region=eu", "content-type": "application/json" },
    body: JSON.stringify({ email: "fresh@example.com", password: "abcdefghijklmno" }),
  })
}

test("regression (PR73 500): wrapping the original POST locks its body for the next handler", () => {
  const original = signupPost()
  new Request(original)
  assert.throws(() => new Request(original))
})

test("session probe keeps the POST body intact for the SDK middleware and the route", async () => {
  const original = signupPost()
  const probe = sessionProbeRequest(original)
  assert.equal(probe.method, "GET")
  assert.equal(probe.body, null)
  assert.equal(probe.headers.get("cookie"), "__session=abc; sbd_region=eu")
  assert.equal(original.bodyUsed, false)
  const rebuiltBySdk = new Request(original)
  assert.deepEqual(await rebuiltBySdk.json(), {
    email: "fresh@example.com",
    password: "abcdefghijklmno",
  })
})

test("wiring: proxy reads the session from the body-free probe, never the original request", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  assert.match(proxy, /getSession\(\s*new NextRequest\(sessionProbeRequest\(request\)\)/)
  assert.doesNotMatch(proxy, /new NextRequest\(request\)/)
})

const sdkUser = { sub: "google-oauth2|123", email: "a@example.com" }

const brand = "dewalt"

for (const market of ["fr", "de", "uk"]) {
  const pending = brandSessionUser(sdkUser, market)

  test(`${market}: SDK callback session is marked pending`, () => {
    assert.equal(isBrandPending(pending), true)
  })

  test(`${market}: pending session cannot open /profile (redirect to reconcile)`, () => {
    assert.deepEqual(decideBrandSessionGate({ market, brand, user: pending, pathname: "/profile" }), {
      action: "redirect",
      location: BRAND_RECONCILE_PATH,
    })
  })

  test(`${market}: pending session gets NO user from /api/me`, () => {
    assert.deepEqual(decideBrandSessionGate({ market, brand, user: pending, pathname: "/api/me" }), {
      action: "anonymous",
    })
  })

  for (const p of [
    "/auth/profile",
    "/auth/access-token",
    "/api/account/profile",
    "/api/account/login-methods",
    "/api/account/passwords",
    "/api/account/password-reset",
  ]) {
    test(`${market}: pending session denied on ${p}`, () => {
      assert.deepEqual(decideBrandSessionGate({ market, brand, user: pending, pathname: p }), {
        action: "deny",
      })
    })
  }

  for (const p of [BRAND_RECONCILE_PATH, "/link-google", "/auth/logout", "/auth/callback", "/auth-error"]) {
    test(`${market}: pending session may reach ${p}`, () => {
      assert.deepEqual(decideBrandSessionGate({ market, brand, user: pending, pathname: p }), {
        action: "allow",
      })
    })
  }

  test(`${market}: session verified for THIS brand+region is allowed everywhere`, () => {
    const verified = brandVerifiedUser(pending, market, brand)
    assert.equal(BRAND_PENDING_CLAIM in verified, false)
    assert.equal(verified.sub, sdkUser.sub)
    assert.equal(isBrandVerified(verified, market, brand), true)
    for (const p of ["/profile", "/api/me", "/auth/profile", "/api/account/profile"]) {
      assert.deepEqual(decideBrandSessionGate({ market, brand, user: verified, pathname: p }), {
        action: "allow",
      })
    }
  })

  test(`${market}: merely cleared (unstamped) session is still held — fails closed`, () => {
    const cleared = clearBrandPending(pending)
    assert.equal(decideBrandSessionGate({ market, brand, user: cleared, pathname: "/profile" }).action, "redirect")
    assert.equal(decideBrandSessionGate({ market, brand, user: cleared, pathname: "/api/me" }).action, "anonymous")
  })

  test(`${market}: claim-free legacy/new-Google session gets NO profile or API access`, () => {
    assert.deepEqual(decideBrandSessionGate({ market, brand, user: sdkUser, pathname: "/profile" }), {
      action: "redirect",
      location: BRAND_RECONCILE_PATH,
    })
    assert.equal(decideBrandSessionGate({ market, brand, user: sdkUser, pathname: "/api/me" }).action, "anonymous")
    assert.equal(decideBrandSessionGate({ market, brand, user: sdkUser, pathname: "/api/account/passwords" }).action, "deny")
  })

  test(`${market}: other-brand verification never opens this brand`, () => {
    const stanley = brandVerifiedUser(sdkUser, market, "stanley")
    assert.equal(decideBrandSessionGate({ market, brand, user: stanley, pathname: "/profile" }).action, "redirect")
    assert.equal(decideBrandSessionGate({ market, brand, user: stanley, pathname: "/api/me" }).action, "anonymous")
  })

  test(`${market}: signed-out visitors are unaffected`, () => {
    assert.deepEqual(decideBrandSessionGate({ market, brand, user: null, pathname: "/profile" }), { action: "allow" })
  })
}

test("cross-region: EU enrollment stamp never grants UK scope (and vice versa)", () => {
  const fr = brandVerifiedUser(sdkUser, "fr", brand)
  assert.equal(decideBrandSessionGate({ market: "uk", brand, user: fr, pathname: "/profile" }).action, "redirect")
  assert.equal(decideBrandSessionGate({ market: "uk", brand, user: fr, pathname: "/api/me" }).action, "anonymous")
  const uk = brandVerifiedUser(sdkUser, "uk", brand)
  assert.equal(decideBrandSessionGate({ market: "fr", brand, user: uk, pathname: "/profile" }).action, "redirect")
})

test("regression (live UK bug): unbound new google-oauth2 session on DeWalt UK gets no profile/API user", () => {
  const fresh = brandSessionUser({ sub: "google-oauth2|104581052827520216143", email: "g@example.com" }, "uk")
  assert.equal(isBrandPending(fresh), true)
  for (const [p, action] of [
    ["/profile", "redirect"],
    ["/api/me", "anonymous"],
    ["/api/account/status", "deny"],
    ["/api/account/passwords", "deny"],
    ["/api/account/login-methods", "deny"],
    ["/auth/access-token", "deny"],
  ] as const) {
    assert.equal(decideBrandSessionGate({ market: "uk", brand, user: fresh, pathname: p }).action, action, p)
  }
})

test("unenforced markets stamp nothing and are never gated", () => {
  assert.equal(isBrandPending(brandSessionUser(sdkUser, "us")), false)
  assert.equal(BRAND_VERIFIED_CLAIM in brandVerifiedUser(sdkUser, "us", brand), false)
  assert.deepEqual(decideBrandSessionGate({ market: "us", brand, user: sdkUser, pathname: "/profile" }), { action: "allow" })
})

test("wiring: every session minter stamps only after a THIS-brand check", () => {
  const pw = readFileSync(new URL("../app/api/signin/password/route.ts", import.meta.url), "utf8")
  assert.match(pw, /outcome\.connectionKey === SITE_BRAND\s*\?\s*brandVerifiedUser\(/)
  const pv = readFileSync(new URL("../app/api/signin/passcode/verify/route.ts", import.meta.url), "utf8")
  assert.match(pv, /handoff\.flow === "database"\s*\?\s*brandVerifiedUser\(/)
  const ps = readFileSync(new URL("../app/api/signin/passcode/start/route.ts", import.meta.url), "utf8")
  assert.match(ps, /resolution\.connectionKey === SITE_BRAND/)
  const core = readFileSync(new URL("./google-link-core.ts", import.meta.url), "utf8")
  assert.match(core, /owns \? brandVerifiedUser\(/)
  const rec = readFileSync(new URL("../app/api/signin/google/reconcile/route.ts", import.meta.url), "utf8")
  assert.match(rec, /enforceBrand && !isBrandVerified\(/)
})

test("wiring: callback hook marks, proxy enforces, reconcile clears only after authorization", () => {
  const cb = readFileSync(new URL("./auth-callback.ts", import.meta.url), "utf8")
  assert.match(cb, /brandSessionUser\(/)
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  assert.match(proxy, /decideBrandSessionGate\(/)
  assert.match(proxy, /"anonymous"/)
  assert.match(proxy, /user: null/)
  const rec = readFileSync(new URL("../app/api/signin/google/reconcile/route.ts", import.meta.url), "utf8")
  assert.match(rec, /clearBrandPending\(/)
})

test("drawer passcode copy is neutral (no 'We sent a one-time passcode')", () => {
  const drawer = readFileSync(new URL("../components/sign-in-drawer.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(drawer, /We sent a one-time passcode to/)
  assert.match(drawer, /has an account for \$\{brand\.name\}, we'll send a code\. Enter it below to sign in\./)
})

test("profile shows a loading state until account status resolves", () => {
  const profile = readFileSync(new URL("../components/customer-profile.tsx", import.meta.url), "utf8")
  assert.match(profile, /const statusLoading = !status && !statusError/)
  assert.match(profile, /statusLoading \? \(/)
  assert.match(profile, /Loading your account…/)
})

// Connect Google (signed-in link) return leg — PR74 live blocker.
const pendingUser = { sub: "google-oauth2|1", [BRAND_PENDING_CLAIM]: true }

test("link complete: pending session WITH verified link intent reaches the route (fr/de)", () => {
  for (const market of ["fr", "de"]) {
    assert.deepEqual(
      decideBrandSessionGate({ brand, market, user: pendingUser, pathname: GOOGLE_LINK_COMPLETE_PATH, linkIntent: true }),
      { action: "allow" },
    )
  }
})

test("link complete: pending session WITHOUT link intent is sent to reconcile, never the route", () => {
  assert.deepEqual(
    decideBrandSessionGate({ brand, market: "fr", user: pendingUser, pathname: GOOGLE_LINK_COMPLETE_PATH }),
    { action: "redirect", location: BRAND_RECONCILE_PATH },
  )
  assert.deepEqual(
    decideBrandSessionGate({ brand, market: "fr", user: pendingUser, pathname: GOOGLE_LINK_COMPLETE_PATH, linkIntent: false }),
    { action: "redirect", location: BRAND_RECONCILE_PATH },
  )
})

test("link intent is scoped to the complete path only — no other API/page/profile opens", () => {
  for (const pathname of ["/api/account/status", "/api/account/identities/google/start", "/auth/profile", "/auth/access-token", "/api/account/identities/google/completeX"]) {
    assert.equal(
      decideBrandSessionGate({ brand, market: "fr", user: pendingUser, pathname, linkIntent: true }).action,
      "deny",
      pathname,
    )
  }
  assert.equal(decideBrandSessionGate({ brand, market: "fr", user: pendingUser, pathname: "/api/me", linkIntent: true }).action, "anonymous")
  assert.equal(decideBrandSessionGate({ brand, market: "fr", user: pendingUser, pathname: "/profile", linkIntent: true }).action, "redirect")
})

test("cookieValue parses one cookie from a raw header", () => {
  assert.equal(cookieValue("a=1; __gl_ho=abc.def; b=2", "__gl_ho"), "abc.def")
  assert.equal(cookieValue("a=1", "__gl_ho"), undefined)
  assert.equal(cookieValue(null, "__gl_ho"), undefined)
  assert.equal(cookieValue("x__gl_ho=bad", "__gl_ho"), undefined)
})

test("wiring: proxy derives link intent from the SIGNED handoff, not cookie presence", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  assert.match(proxy, /decodeGoogleLinkHandoff\(/)
  assert.match(proxy, /pathname === GOOGLE_LINK_COMPLETE_PATH/)
  assert.match(proxy, /linkIntent,/)
})

test("wiring: link start is NOT reachable while pending; complete re-mints a non-pending primary", () => {
  const start = readFileSync(new URL("../app/api/account/identities/google/start/route.ts", import.meta.url), "utf8")
  assert.match(start, /requireAccountUser\(\)/)
  assert.match(start, /encodeGoogleLinkHandoff\(\{ primarySub: guard\.user\.sub/)
  const complete = readFileSync(new URL("../app/api/account/identities/google/complete/route.ts", import.meta.url), "utf8")
  assert.match(complete, /currentSub === primarySub\) \{\s*return finish\("linked", await restorePrimary\(primarySub\)\)/)
  const core = readFileSync(new URL("./google-link-core.ts", import.meta.url), "utf8")
  const minted = core.slice(core.indexOf("export async function mintPrimarySessionCookie"))
  assert.doesNotMatch(minted.slice(0, minted.indexOf("generateSessionCookie(")), new RegExp(BRAND_PENDING_CLAIM))
})
