import { NextResponse, type NextRequest } from "next/server"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { getUser, isManagementConfigured } from "@/lib/auth0-management"
import {
  GOOGLE_LINK_COOKIE_NAME,
  decodeGoogleLinkHandoff,
} from "@/lib/google-link-handoff"
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  linkStandaloneGoogle,
  mintPrimarySessionCookie,
} from "@/lib/google-link-core"

// GET /api/account/identities/google/complete
// ============================================
// Step 2 of the "Connect Google" LINK flow. Auth0 returns here after the Google
// login; at this point the SDK session belongs to WHOEVER Google resolved to,
// NOT necessarily the account that started the link. We read the stashed
// primary sub from the handoff cookie and branch on three outcomes:
//
//   1. session.sub === primary  → the post-login Action already linked it
//      (the Google email matched the account email). Nothing to do; success.
//   2. session user has exactly ONE identity, google-oauth2 → a standalone
//      Google record (the mismatched-email case). Link it onto the primary.
//   3. session user has MORE than one identity → that Google account is already
//      attached to a different customer. Refuse; do not link.
//
// After any case where the session is NOT already the primary, we RESTORE the
// primary session (minted from its Management record, same __session shape as
// app/api/signin/password/route.ts) so the person is never stranded in a
// stranger's session or a half-linked state. Every path ends on /profile signed
// in as the primary with a readable ?google= result the row renders.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Result = "linked" | "in_use" | "error"

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie")

  // Build the /profile redirect, always clearing the handoff cookie, and
  // optionally installing a freshly-minted primary session cookie.
  function finish(result: Result, primaryCookie?: string | null): NextResponse {
    const url = new URL("/profile", request.url)
    url.searchParams.set("google", result)
    const res = NextResponse.redirect(url)
    res.cookies.set(GOOGLE_LINK_COOKIE_NAME, "", { path: "/", maxAge: 0 })
    if (primaryCookie) {
      res.cookies.set(SESSION_COOKIE_NAME, primaryCookie, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      })
    }
    return res
  }

  // Restore the primary account's session (shared with the reconcile flow).
  const restorePrimary = (primarySub: string) =>
    mintPrimarySessionCookie(primarySub, cookieHeader)

  // No real Auth0 (e.g. the sandbox): nothing to complete — land on the profile.
  if (!isAuthConfigured()) return finish("error")

  const handoff = decodeGoogleLinkHandoff(
    request.cookies.get(GOOGLE_LINK_COOKIE_NAME)?.value,
  )
  // No trustworthy handoff → we don't know which account to link onto. Bail to
  // the profile; whatever session exists is left untouched.
  if (!handoff) return finish("error")
  const primarySub = handoff.primarySub

  let session: Awaited<ReturnType<typeof auth0.getSession>> = null
  try {
    session = await auth0.getSession()
  } catch {
    session = null
  }
  const currentSub = session?.user?.sub as string | undefined

  // The Google login produced no session (cancelled/failed). Put the person
  // back into their primary session so they're never left signed-out mid-link.
  if (!currentSub) return finish("error", await restorePrimary(primarySub))

  // OUTCOME 1 — the Action already linked (emails matched). Already primary.
  if (currentSub === primarySub) return finish("linked")

  // From here the session belongs to some OTHER user; we must inspect it and,
  // whatever happens, restore the primary session before redirecting. Without
  // the Management API we can neither inspect nor restore — bail readably.
  if (!isManagementConfigured()) return finish("error")

  let currentUser
  try {
    currentUser = await getUser(currentSub)
  } catch {
    return finish("error", await restorePrimary(primarySub))
  }

  // OUTCOMES 2 & 3 — link a standalone Google record onto the primary, or refuse
  // when it's already attached elsewhere. The link + alias + refusal rules live
  // in the shared core so this flow and the cold-login reconcile behave
  // identically. Whatever the result, restore the primary session.
  const result = await linkStandaloneGoogle(primarySub, currentUser)
  return finish(result, await restorePrimary(primarySub))
}
