import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  BRAND_PENDING_CLAIM,
  BRAND_RECONCILE_PATH,
  brandSessionUser,
  clearBrandPending,
  decideBrandSessionGate,
  isBrandPending,
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

for (const market of ["fr", "de"]) {
  const pending = brandSessionUser(sdkUser, market)

  test(`${market}: SDK callback session is marked pending`, () => {
    assert.equal(isBrandPending(pending), true)
  })

  test(`${market}: pending session cannot open /profile (redirect to reconcile)`, () => {
    assert.deepEqual(decideBrandSessionGate({ market, user: pending, pathname: "/profile" }), {
      action: "redirect",
      location: BRAND_RECONCILE_PATH,
    })
  })

  test(`${market}: pending session gets NO user from /api/me`, () => {
    assert.deepEqual(decideBrandSessionGate({ market, user: pending, pathname: "/api/me" }), {
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
      assert.deepEqual(decideBrandSessionGate({ market, user: pending, pathname: p }), {
        action: "deny",
      })
    })
  }

  for (const p of [BRAND_RECONCILE_PATH, "/link-google", "/auth/logout", "/auth/callback", "/auth-error"]) {
    test(`${market}: pending session may reach ${p}`, () => {
      assert.deepEqual(decideBrandSessionGate({ market, user: pending, pathname: p }), {
        action: "allow",
      })
    })
  }

  test(`${market}: reconciled (cleared) session is allowed everywhere`, () => {
    const cleared = clearBrandPending(pending)
    assert.equal(BRAND_PENDING_CLAIM in cleared, false)
    assert.equal(cleared.sub, sdkUser.sub)
    for (const p of ["/profile", "/api/me", "/auth/profile", "/api/account/profile"]) {
      assert.deepEqual(decideBrandSessionGate({ market, user: cleared, pathname: p }), {
        action: "allow",
      })
    }
  })

  test(`${market}: forged pending:false-free session without the claim is allowed (password/passcode routes)`, () => {
    assert.deepEqual(
      decideBrandSessionGate({ market, user: sdkUser, pathname: "/profile" }),
      { action: "allow" },
    )
  })
}

test("uk: callback sessions are not marked and are never gated (UK unchanged)", () => {
  const u = brandSessionUser(sdkUser, "uk")
  assert.equal(isBrandPending(u), false)
  assert.deepEqual(
    decideBrandSessionGate({ market: "uk", user: { ...sdkUser, [BRAND_PENDING_CLAIM]: true }, pathname: "/profile" }),
    { action: "allow" },
  )
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
