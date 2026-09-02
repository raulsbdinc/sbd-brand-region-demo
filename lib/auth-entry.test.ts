import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseAuthMode,
  authModeQueryValue,
  sanitizeReturnTo,
  buildDrawerRedirect,
  AUTH_QUERY_KEY,
  RETURN_TO_QUERY_KEY,
} from "./auth-entry.ts"

// parseAuthMode ---------------------------------------------------------------

test("parseAuthMode maps sign-in aliases", () => {
  assert.equal(parseAuthMode("signin"), "sign-in")
  assert.equal(parseAuthMode("sign-in"), "sign-in")
  assert.equal(parseAuthMode("SignIn"), "sign-in")
  assert.equal(parseAuthMode("  signin  "), "sign-in")
})

test("parseAuthMode maps create-account aliases", () => {
  assert.equal(parseAuthMode("create"), "create-account")
  assert.equal(parseAuthMode("create-account"), "create-account")
  assert.equal(parseAuthMode("CREATE"), "create-account")
})

test("parseAuthMode returns null for absent/unknown values (no auto-open on a normal / visit)", () => {
  assert.equal(parseAuthMode(null), null)
  assert.equal(parseAuthMode(undefined), null)
  assert.equal(parseAuthMode(""), null)
  assert.equal(parseAuthMode("register"), null)
  assert.equal(parseAuthMode("true"), null)
})

// authModeQueryValue ----------------------------------------------------------

test("authModeQueryValue round-trips through parseAuthMode", () => {
  assert.equal(authModeQueryValue("sign-in"), "signin")
  assert.equal(authModeQueryValue("create-account"), "create")
  assert.equal(parseAuthMode(authModeQueryValue("sign-in")), "sign-in")
  assert.equal(parseAuthMode(authModeQueryValue("create-account")), "create-account")
})

// sanitizeReturnTo ------------------------------------------------------------

test("sanitizeReturnTo accepts a safe rooted same-site path", () => {
  assert.equal(sanitizeReturnTo("/profile"), "/profile")
  assert.equal(sanitizeReturnTo("/profile?tab=security"), "/profile?tab=security")
  assert.equal(sanitizeReturnTo("  /profile  "), "/profile")
})

test("sanitizeReturnTo fails closed on open-redirect / off-origin attempts", () => {
  assert.equal(sanitizeReturnTo("//evil.com"), null)
  assert.equal(sanitizeReturnTo("https://evil.com"), null)
  assert.equal(sanitizeReturnTo("http://evil.com"), null)
  assert.equal(sanitizeReturnTo("/\\evil.com"), null)
  assert.equal(sanitizeReturnTo("/%2fevil.com"), null)
  assert.equal(sanitizeReturnTo("/%5cevil.com"), null)
  assert.equal(sanitizeReturnTo("profile"), null) // not rooted
  assert.equal(sanitizeReturnTo("javascript:alert(1)"), null)
  assert.equal(sanitizeReturnTo("/path with space"), null)
  assert.equal(sanitizeReturnTo("/path\nnewline"), null)
  assert.equal(sanitizeReturnTo("/back\\slash"), null)
  assert.equal(sanitizeReturnTo(""), null)
  assert.equal(sanitizeReturnTo(null), null)
  assert.equal(sanitizeReturnTo(undefined), null)
  // @ts-expect-error non-string input must fail closed
  assert.equal(sanitizeReturnTo(123), null)
})

// buildDrawerRedirect ---------------------------------------------------------

test("buildDrawerRedirect emits a clean root path with the auth signal (sign-in)", () => {
  const target = buildDrawerRedirect({ mode: "sign-in" })
  const url = new URL(target, "https://example.com")
  assert.equal(url.pathname, "/")
  assert.equal(url.searchParams.get(AUTH_QUERY_KEY), "signin")
  assert.equal(url.searchParams.get(RETURN_TO_QUERY_KEY), null)
})

test("buildDrawerRedirect emits create mode", () => {
  const target = buildDrawerRedirect({ mode: "create-account" })
  const url = new URL(target, "https://example.com")
  assert.equal(url.pathname, "/")
  assert.equal(url.searchParams.get(AUTH_QUERY_KEY), "create")
})

test("buildDrawerRedirect includes a safe returnTo and drops an unsafe one", () => {
  const safe = buildDrawerRedirect({ mode: "sign-in", returnTo: "/profile" })
  const safeUrl = new URL(safe, "https://example.com")
  assert.equal(safeUrl.searchParams.get(RETURN_TO_QUERY_KEY), "/profile")

  const unsafe = buildDrawerRedirect({ mode: "sign-in", returnTo: "//evil.com" })
  const unsafeUrl = new URL(unsafe, "https://example.com")
  assert.equal(unsafeUrl.searchParams.get(RETURN_TO_QUERY_KEY), null)
  assert.equal(unsafeUrl.pathname, "/")
})

test("buildDrawerRedirect output is itself parseable back into the same mode", () => {
  for (const mode of ["sign-in", "create-account"] as const) {
    const target = buildDrawerRedirect({ mode })
    const url = new URL(target, "https://example.com")
    assert.equal(parseAuthMode(url.searchParams.get(AUTH_QUERY_KEY)), mode)
  }
})
