// SHARED AUTH0 CALLBACK HOOK (server-only)
// ========================================
// Both the base Auth0 client (lib/auth0.ts) and the per-region clients
// (lib/auth0-regions.ts) use this single `onCallback` hook so a failed sign-in
// lands on a friendly page instead of the SDK's default behaviour, which dumps
// the raw Auth0 error string into the response.
//
// The most common failure in this POC is `error=unauthorized &
// error_description=user is blocked`: our own soft-delete flow
// (POST /api/account/delete) sets `blocked: true` on the Auth0 user, so when
// that user tries to sign in again Auth0 rejects them at the callback. We detect
// that case and route to /auth-error?reason=blocked, which explains the account
// was deactivated and how to restore it during the grace window.
//
// SECURITY: Auth0 callback errors can contain reflected user input in
// `error`/`error_description`/`message`. We NEVER put those raw strings in the
// redirect or render them — we classify into a small fixed set of reasons and
// let the /auth-error page render safe, hard-coded copy. Full detail is only
// logged server-side.

import "server-only"
import { NextResponse } from "next/server"
import { filterDefaultIdTokenClaims } from "@auth0/nextjs-auth0/server"
import type { SessionData } from "@auth0/nextjs-auth0/types"
import { brandSessionUser } from "@/lib/brand-session-gate"
import { SITE_MARKET } from "@/lib/site"

/**
 * Shared `beforeSessionSaved` hook. Keeps the SDK's default claim filtering
 * (supplying a hook disables it) and, on EU storefronts, marks every
 * SDK-callback session as brand-PENDING so the proxy gates it until
 * /api/signin/google/reconcile verifies this storefront's brand enrollment.
 */
export async function brandBeforeSessionSaved(
  session: SessionData,
): Promise<SessionData> {
  return {
    ...session,
    user: brandSessionUser(filterDefaultIdTokenClaims(session.user), SITE_MARKET),
  }
}

/** Structural shape of the SDK error we care about (avoids importing internals).
 *  `cause` is typed `unknown` to stay assignable to the SDK's `SdkError`. */
type SdkErrorLike = {
  code?: string
  message?: string
  cause?: unknown
} | null

type CallbackCtx = {
  appBaseUrl?: string
  returnTo?: string
}

/** Fixed, safe reason codes the /auth-error page knows how to render. */
export type AuthErrorReason =
  | "blocked"
  | "access_denied"
  | "state"
  | "config"
  | "error"
  // Set by the cold-Google reconcile route (app/api/signin/google/reconcile)
  // when a duplicate collision can't be safely resolved and it fails closed.
  | "link_ambiguous"
  | "link_unavailable"

/**
 * Map an SDK callback error to a safe reason code. Never returns raw error text.
 */
function classify(error: SdkErrorLike): AuthErrorReason {
  if (!error) return "error"
  const cause = (error.cause ?? {}) as { code?: string; message?: string }
  const causeCode = (cause.code ?? "").toLowerCase()
  const text = `${cause.message ?? ""} ${error.message ?? ""}`.toLowerCase()
  const code = (error.code ?? "").toLowerCase()

  if (text.includes("blocked")) return "blocked"
  if (causeCode === "access_denied" || text.includes("access_denied")) {
    return "access_denied"
  }
  if (code.includes("state")) return "state"
  if (code.includes("config") || code.includes("discovery")) return "config"
  return "error"
}

/**
 * Shared `onCallback` handler. On error, redirect to /auth-error with a safe
 * reason. On success, replicate the SDK default (redirect to `returnTo`, or the
 * post-login landing page /live).
 */
export async function authCallbackHandler(
  error: SdkErrorLike,
  ctx: CallbackCtx,
): Promise<NextResponse> {
  const base = ctx.appBaseUrl

  if (error) {
    const reason = classify(error)
    const cause = (error.cause ?? {}) as { code?: string }
    // Full detail server-side only — never reflected to the client.
    console.log(
      "[v0] auth callback error:",
      "code=", error.code,
      "cause=", cause.code,
      "message=", error.message,
      "-> reason=", reason,
    )
    if (base) {
      const url = new URL("/auth-error", base)
      url.searchParams.set("reason", reason)
      return NextResponse.redirect(url.toString())
    }
    // No resolvable base URL: fail closed with a minimal, safe message.
    return new NextResponse("Sign-in could not be completed.", { status: 500 })
  }

  const dest = ctx.returnTo || "/live"
  if (base) {
    return NextResponse.redirect(new URL(dest, base).toString())
  }
  // Extremely unlikely (SDK resolves appBaseUrl from the request host).
  return NextResponse.redirect(dest)
}
