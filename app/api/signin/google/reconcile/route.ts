import { NextResponse, type NextRequest } from "next/server"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import {
  getUser,
  isManagementConfigured,
  type Auth0User,
} from "@/lib/auth0-management"
import { resolveExistingAccountByEmail } from "@/lib/credential-resolver"
import {
  planGoogleReconcile,
  type ExistingAccountFacts,
  type GoogleSessionFacts,
} from "@/lib/google-reconcile"
import {
  SESSION_COOKIE_NAME,
  deleteStandaloneGoogleDuplicate,
} from "@/lib/google-link-core"
import {
  journeyCookieName,
  journeyCookieOptions,
  mintJourneyToken,
} from "@/lib/journey-handoff"

// GET /api/signin/google/reconcile
// ================================
// The landing route for a COLD "Continue with Google" sign-in (someone signed
// out clicking Google). Auth0 has just minted a STANDALONE google-oauth2 user
// and this app's __session now belongs to it. Before we let that duplicate be
// used, we check whether its VERIFIED email already belongs to another SBD
// account and, if so, divert into an ownership-proof journey (/link-google)
// that links the Google identity onto the existing primary — never a match on
// email alone.
//
// The DECISION is the pure planner (lib/google-reconcile.ts); this route only
// gathers the session + directory facts and executes the returned action. Every
// non-happy branch FAILS CLOSED: an ambiguous or unprovable collision ends the
// standalone session and removes the duplicate rather than operating it.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const GOOGLE_LINK_PURPOSE = "google-link" as const

/** The signed handoff carried across to the /link-google proof step. Non-secret
 *  routing facts only — never a password, OTP, or token. */
export interface GoogleReconcileHandoff extends Record<string, unknown> {
  primaryUserId: string
  googleSub: string
  googleUserId: string
  email: string
  /** The primary's owned/verified emails — the mailbox an OTP proof may use. */
  verifiedEmails: string[]
}

export async function GET(request: NextRequest) {
  const profile = () => NextResponse.redirect(new URL("/profile", request.url))

  // No real Auth0 (sandbox) — nothing to reconcile.
  if (!isAuthConfigured()) return profile()

  let session: Awaited<ReturnType<typeof auth0.getSession>> = null
  try {
    session = await auth0.getSession()
  } catch {
    session = null
  }
  const currentSub = session?.user?.sub as string | undefined

  // The Google login produced no session (cancelled/failed at the IdP) — send
  // the person back to the front door rather than a blank profile.
  if (!currentSub) return NextResponse.redirect(new URL("/", request.url))

  const management = isManagementConfigured()

  // Build the session facts the planner needs. Identity shape requires the
  // Management record; when Management is off the planner short-circuits to
  // "proceed" before it is ever consulted, so we only fetch when configured.
  let record: Auth0User | null = null
  if (management && currentSub.startsWith("google-oauth2|")) {
    try {
      record = await getUser(currentSub)
    } catch {
      // Can't inspect the record → we cannot prove a duplicate. Leave the
      // Google session as-is (there is nothing safe to link onto).
      return profile()
    }
  }

  const identities = record?.identities ?? []
  const google: GoogleSessionFacts = {
    sub: currentSub,
    email:
      record?.email ??
      (session?.user?.email as string | undefined) ??
      "",
    emailVerified:
      record?.email_verified === true ||
      session?.user?.email_verified === true,
    identityCount: record ? identities.length : 1,
    soleProvider: record ? (identities[0]?.provider ?? null) : "google-oauth2",
  }

  // Only look the email up once we know it's a lone verified Google record and
  // Management is available — otherwise the planner ignores `existing`.
  let existing: ExistingAccountFacts | undefined
  const looksStandalone =
    management &&
    google.sub.startsWith("google-oauth2|") &&
    google.identityCount === 1 &&
    google.soleProvider === "google-oauth2" &&
    google.emailVerified === true
  let verifiedEmails: string[] = []
  if (looksStandalone) {
    // Exclude the transient standalone google-oauth2 user Auth0 just minted:
    // its own root email IS this Gmail, so counting it as a candidate owner
    // would inflate a single real alias owner into a false "ambiguous".
    const res = await resolveExistingAccountByEmail(String(google.email), {
      excludeUserId: currentSub,
    })
    if (res.kind === "single") {
      existing = { kind: "single", auth0UserId: res.account.auth0UserId }
      verifiedEmails = res.account.verifiedEmails
    } else {
      existing = res
    }
  }

  const decision = planGoogleReconcile({
    managementConfigured: management,
    google,
    existing,
  })

  if (decision.action === "proceed") {
    return profile()
  }

  if (decision.action === "fail-closed") {
    // End the standalone Google session and best-effort remove the duplicate so
    // it can never be operated. Route to a safe, fixed error page.
    await deleteStandaloneGoogleDuplicate(currentSub)
    const url = new URL("/auth-error", request.url)
    url.searchParams.set(
      "reason",
      decision.reason === "ambiguous" ? "link_ambiguous" : "link_unavailable",
    )
    const res = NextResponse.redirect(url)
    for (const c of request.cookies.getAll()) {
      if (c.name === SESSION_COOKIE_NAME || c.name.startsWith(SESSION_COOKIE_NAME)) {
        res.cookies.set(c.name, "", { path: "/", maxAge: 0 })
      }
    }
    return res
  }

  // require-proof — carry the (non-secret) routing facts to the proof page.
  const pipe = currentSub.indexOf("|")
  const handoff: GoogleReconcileHandoff = {
    primaryUserId: decision.primaryUserId,
    googleSub: currentSub,
    googleUserId: pipe >= 0 ? currentSub.slice(pipe + 1) : currentSub,
    email: decision.email,
    verifiedEmails,
  }
  const res = NextResponse.redirect(new URL("/link-google", request.url))
  res.cookies.set(
    journeyCookieName(GOOGLE_LINK_PURPOSE),
    mintJourneyToken(GOOGLE_LINK_PURPOSE, handoff),
    journeyCookieOptions(),
  )
  return res
}
