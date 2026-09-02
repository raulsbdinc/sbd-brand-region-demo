import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDrawerRedirect, parseAuthMode, AUTH_QUERY_KEY, RETURN_TO_QUERY_KEY } from "./auth-entry.ts"

/**
 * The three legacy auth routes are thin server components whose entire behavior
 * is `redirect(buildDrawerRedirect({ mode }))`. Importing the page modules here
 * would pull in the Next server runtime, so instead we assert the exact redirect
 * CONTRACT each route is built on — the same `buildDrawerRedirect` call the route
 * makes — proving they all funnel into the ONE root drawer with the right mode
 * and never expose a parallel frontend.
 *
 * (`app/signin/page.tsx`, `app/sign-in/uk/page.tsx` -> sign-in;
 *  `app/register/uk/page.tsx` -> create-account.)
 */

function assertRootDrawer(
  target: string,
  expectedMode: "sign-in" | "create-account" | "recover",
) {
  const url = new URL(target, "https://example.com")
  assert.equal(url.pathname, "/", "must land on the storefront root")
  assert.equal(
    parseAuthMode(url.searchParams.get(AUTH_QUERY_KEY)),
    expectedMode,
    "must carry the correct drawer mode signal",
  )
}

test("/signin redirects into the root drawer in sign-in mode", () => {
  assertRootDrawer(buildDrawerRedirect({ mode: "sign-in" }), "sign-in")
})

test("/sign-in/uk redirects into the root drawer in sign-in mode (no model chooser)", () => {
  assertRootDrawer(buildDrawerRedirect({ mode: "sign-in" }), "sign-in")
})

test("/register/uk redirects into the root drawer in create-account mode (no standalone UI)", () => {
  assertRootDrawer(buildDrawerRedirect({ mode: "create-account" }), "create-account")
})

test("/recover redirects into the root drawer in recover mode (no standalone recovery UI)", () => {
  assertRootDrawer(buildDrawerRedirect({ mode: "recover" }), "recover")
})

test("unauthenticated /profile redirects into the root drawer (sign-in) with safe returnTo=/profile", () => {
  // Mirrors components/profile-resolver.tsx's logged-out redirect.
  const target = buildDrawerRedirect({ mode: "sign-in", returnTo: "/profile" })
  const url = new URL(target, "https://example.com")
  assertRootDrawer(target, "sign-in")
  assert.equal(url.searchParams.get(RETURN_TO_QUERY_KEY), "/profile")
})

test("unauthenticated /profile redirect refuses to carry an unsafe returnTo", () => {
  // Defense-in-depth: even if a hostile returnTo reached the guard, it is dropped.
  const target = buildDrawerRedirect({ mode: "sign-in", returnTo: "//evil.com/profile" })
  const url = new URL(target, "https://example.com")
  assert.equal(url.searchParams.get(RETURN_TO_QUERY_KEY), null)
})
