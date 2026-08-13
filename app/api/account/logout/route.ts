import { type NextRequest, NextResponse } from "next/server"

// LOCAL logout — ends the session and stays ON the demo site
// ==========================================================
// GET /api/account/logout clears the app's own session and returns the person
// to the demo home on OUR origin, with NO Auth0 round trip. This deliberately
// replaces the SDK-mounted /auth/logout federated flow (which redirected to
// Auth0's hosted /v2/logout "Are you sure you want to log out" page on the
// auth0app.com domain, taking the customer off the demo site).
//
// WHY local logout is correct here:
//   - Password and passcode sign-in are EMBEDDED — the session is this app's
//     own __session cookie, so there is no browser Auth0 SSO session to end.
//   - Google sign-in already uses prompt=login, so a persisted IdP session
//     never causes a silent re-login after signing out.
//   - The per-domain __session boundary the demo relies on is unaffected.
// So deleting the local session cookie is sufficient and correct.

export const dynamic = "force-dynamic"

// The SDK session cookie, plus the split chunk variants it writes when the
// session is too large for a single cookie. All are cleared with path "/" and
// maxAge 0 so none can survive the logout.
const SESSION_COOKIES = ["__session", "__session.0", "__session.1", "__session.2"]

export async function GET(request: NextRequest) {
  // Same-origin redirect to the demo home — keeps the person on OUR site.
  const response = NextResponse.redirect(new URL("/", request.url))
  for (const name of SESSION_COOKIES) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 })
  }
  return response
}
