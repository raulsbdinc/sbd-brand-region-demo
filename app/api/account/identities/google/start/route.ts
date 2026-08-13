import { NextResponse, type NextRequest } from "next/server"
import { requireAccountUser } from "@/lib/account-guard"
import {
  GOOGLE_LINK_COOKIE_NAME,
  GOOGLE_LINK_TTL_SECONDS,
  encodeGoogleLinkHandoff,
} from "@/lib/google-link-handoff"

// GET /api/account/identities/google/start
// =========================================
// Step 1 of the explicit "Connect Google" LINK flow (initiated from the profile
// while signed in). This is NOT a sign-in: it proves the person holds a Google
// account and then LINKS that Google identity onto the account they are already
// managing — so a personal Gmail whose address differs from the account email
// does not spawn a second, separately-billable user.
//
// It stashes the current signed-in `sub` in a short-lived httpOnly handoff
// cookie and redirects into Auth0's Google login, returning to the `complete`
// route below. `complete` reads the stashed sub back and does the linking.
//
// `prompt=login` forces Google to actually authenticate this trip rather than
// silently reusing an existing IdP session, so we genuinely prove the person
// holds the Google account before attaching it.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const COMPLETE_PATH = "/api/account/identities/google/complete"

export async function GET(request: NextRequest) {
  // Any guard failure (not signed in, or Auth0/Management not configured — e.g.
  // in the sandbox) lands gracefully back on the profile rather than dumping
  // JSON at a top-level navigation.
  const guard = await requireAccountUser()
  if (!guard.ok) {
    return NextResponse.redirect(new URL("/profile?google=error", request.url))
  }

  const loginUrl = new URL("/auth/login", request.url)
  loginUrl.searchParams.set("connection", "google-oauth2")
  loginUrl.searchParams.set("prompt", "login")
  loginUrl.searchParams.set("returnTo", COMPLETE_PATH)

  const response = NextResponse.redirect(loginUrl)
  response.cookies.set(
    GOOGLE_LINK_COOKIE_NAME,
    encodeGoogleLinkHandoff({ primarySub: guard.user.sub, iat: Date.now() }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: GOOGLE_LINK_TTL_SECONDS,
    },
  )
  return response
}
