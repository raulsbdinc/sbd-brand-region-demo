// AUTH0 CONNECTION MAP + LOGIN URL BUILDER
// ========================================
// The mock flows (lib/auth-service.ts) drive the cinematic custom screens. When
// a flow is "promoted" to real auth, its branded intro stays, but the actual
// authentication is delegated to Auth0 Universal Login via a full-page redirect
// to the proxy-mounted /auth/login route.
//
// The Auth0 SDK v4 login handler forwards every query param it doesn't reserve
// (everything except `returnTo`, `scopes`, `challengeMode`) straight through to
// Auth0's /authorize endpoint. That means we can pre-select a specific provider
// with `connection=...` and pre-fill the email with `login_hint=...`, so the
// user lands directly on the right screen instead of the generic picker.

import type { SocialProvider } from "./types"
import { SITE_CONNECTION } from "./site"

/**
 * The one-click "Continue with Google" / "Connect Google" navigation target,
 * shared by the sign-in drawer and the customer profile so both stay identical.
 *
 * `prompt=login` is REQUIRED here, not cosmetic. Once a visitor signs in with
 * Google on one brand (say DeWalt France), Auth0 holds an IdP session for them.
 * Without `prompt=login`, clicking Google on another brand (Stanley France)
 * would sign them straight in with no interaction at all — which directly
 * contradicts the thing this demo exists to show: that each brand challenges
 * you again even though it is one underlying account. With it, Auth0
 * re-challenges on every site. `returnTo` lands the finished login back on the
 * customer profile. (A verified-email Google sign-in is attached to any
 * existing password account server-side by an Auth0 Action, so this path never
 * needs to call a link endpoint.)
 */
export const GOOGLE_SIGNIN_PATH =
  "/auth/login?connection=google-oauth2&prompt=login&returnTo=/profile"

/**
 * Auth0 connection names for each social provider.
 *
 * These are the default upstream connection identifiers Auth0 uses. If the SBD
 * tenant names a connection differently, update the value here — the key (our
 * SocialProvider) stays the same so the UI never changes.
 */
export const SOCIAL_CONNECTIONS: Record<SocialProvider, string> = {
  Google: "google-oauth2",
  Apple: "apple",
  Microsoft: "windowslive",
  Facebook: "facebook",
  GitHub: "github",
  LinkedIn: "linkedin",
  X: "twitter",
}

/**
 * The database connection backing the "Classic password" flow for THIS
 * deployment. Each brand-region site is a separate Vercel project with its own
 * Auth0 database connection, so this is initialised per-deployment from
 * SITE_CONNECTION (NEXT_PUBLIC_AUTH0_CONNECTION — e.g. "dewalt-fr",
 * "craftsman-fr"), falling back to Auth0's default "Username-Password-
 * Authentication" when the env var is missing. This is the mechanism that gives
 * each brand-region site its own password store: both consumers
 * (components/flows/password-flow.tsx and app/api/recovery/route.ts) import this
 * constant, so they authenticate against the right connection automatically.
 */
export const PASSWORD_CONNECTION = SITE_CONNECTION

/**
 * The passwordless email connection backing BOTH the "Email code" and "Magic
 * link" flows. Auth0 uses a single `email` connection for passwordless email;
 * whether it sends a one-time code or a magic link is a setting on that
 * connection, not a per-request parameter — which is why the two flows promote
 * onto the same connection name. Override here if the tenant names it
 * differently.
 */
export const PASSWORDLESS_EMAIL_CONNECTION = "email"

/**
 * Whether the passwordless email connection is actually enabled and verified on
 * the SBD tenant. A provider whose connection isn't enabled is rejected at
 * `/authorize`, which would break the showcase — so, exactly like the social
 * providers, this defaults to OFF and the polished cinematic mock keeps running
 * until the connection is confirmed working.
 *
 * Flip it on by setting `NEXT_PUBLIC_AUTH0_PASSWORDLESS` to "1"/"true"/"on"
 * (any other value, or absence, leaves it off). Once enabled — and with the
 * Auth0 env vars present — the email-code and magic-link flows perform a real
 * redirect login instead of the simulation.
 */
export function isPasswordlessLive(): boolean {
  const raw = process.env.NEXT_PUBLIC_AUTH0_PASSWORDLESS
  if (!raw) return false
  return ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase())
}

/**
 * Which social providers are actually enabled and verified on the SBD tenant.
 * Only these get a "Live" badge and are clickable in the picker; the rest are
 * shown as "Not configured".
 *
 * Configure via the public env var `NEXT_PUBLIC_AUTH0_LIVE_PROVIDERS` (a
 * comma-separated list, e.g. "Google,Microsoft"). Defaults to Google, the one
 * connection confirmed working. Values are matched case-insensitively against
 * SocialProvider names; unknown values are ignored.
 */
export function getLiveSocialProviders(): SocialProvider[] {
  const known = Object.keys(SOCIAL_CONNECTIONS) as SocialProvider[]
  const raw = process.env.NEXT_PUBLIC_AUTH0_LIVE_PROVIDERS
  if (!raw) return ["Google"]
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const matched = known.filter((p) => requested.includes(p.toLowerCase()))
  return matched.length > 0 ? matched : ["Google"]
}

/**
 * Build a URL to the proxy-mounted Auth0 login route.
 *
 * @param connection  Auth0 connection to pre-select (skips the IdP picker).
 * @param returnTo     In-app path to land on after a successful login.
 * @param loginHint    Optional email to pre-fill on the Auth0 screen.
 * @param screenHint   Optional "signup" to land users on the create-account
 *                     screen of Universal Login (identifier-first sign-up).
 */
export function buildAuthLoginUrl({
  connection,
  returnTo = "/profile",
  loginHint,
  screenHint,
  organization,
  invitation,
}: {
  connection?: string
  returnTo?: string
  loginHint?: string
  screenHint?: "login" | "signup"
  organization?: string
  invitation?: string
}): string {
  const params = new URLSearchParams()
  if (connection) params.set("connection", connection)
  if (returnTo) params.set("returnTo", returnTo)
  if (loginHint) params.set("login_hint", loginHint)
  if (screenHint) params.set("screen_hint", screenHint)
  if (organization) params.set("organization", organization)
  if (invitation) params.set("invitation", invitation)
  const qs = params.toString()
  return qs ? `/auth/login?${qs}` : "/auth/login"
}

/**
 * Kick off an Auth0 redirect login, accounting for embedded (iframe) contexts.
 *
 * Auth0's hosted Universal Login refuses to be framed (it sends
 * `X-Frame-Options` / a restrictive `frame-ancestors`), and embedding parents
 * like the v0 preview enforce a `frame-src` allowlist. So when the app is
 * running inside an iframe, navigating the *current* frame to `/auth/login`
 * lands us on a page the parent CSP blocks — surfacing as a framing/"CORS"
 * error. To avoid that we break out of the frame and run the login at the top
 * level by opening it in a new tab. When not framed (a normal standalone
 * deployment), we just do an ordinary same-window redirect.
 *
 * Must be called from a user gesture (e.g. a click/submit handler) so the
 * new-tab open isn't treated as an unsolicited popup.
 */
export function startAuthRedirect(url: string): void {
  if (typeof window === "undefined") return

  let framed = false
  try {
    framed = window.self !== window.top
  } catch {
    // Accessing window.top across origins can throw — that itself means we're framed.
    framed = true
  }

  if (framed) {
    // Top-level break-out. A new tab reliably escapes the parent's frame-src
    // allowlist; we avoid rewriting window.top.location since that would
    // navigate the embedding page (e.g. the whole v0 editor) away.
    const opened = window.open(url, "_blank", "noopener,noreferrer")
    if (opened) return
    // Popup blocked: fall back to navigating the top frame directly.
    try {
      if (window.top) {
        window.top.location.href = url
        return
      }
    } catch {
      // Ignore and fall through to a same-frame navigation as a last resort.
    }
  }

  window.location.href = url
}
