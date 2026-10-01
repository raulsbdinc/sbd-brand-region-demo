import { NextResponse, type NextRequest } from "next/server"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import {
  getUser,
  isManagementConfigured,
  type Auth0User,
} from "@/lib/auth0-management"
import { resolveExistingAccountByEmail } from "@/lib/credential-resolver"
import { brandAccessEnforced, identitiesAuthorizeBrand } from "@/lib/brand-access"
import { resolveConnectionNames } from "@/lib/credential-model"
import { clearBrandPending, isBrandPending } from "@/lib/brand-session-gate"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
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

/** End the current session (all chunks) and land on a fixed, safe error page. */
function endSession(
  request: NextRequest,
  reason: "link_unavailable" | "link_ambiguous",
): NextResponse {
  const url = new URL("/auth-error", request.url)
  url.searchParams.set("reason", reason)
  const res = NextResponse.redirect(url)
  for (const c of request.cookies.getAll()) {
    if (c.name === SESSION_COOKIE_NAME || c.name.startsWith(SESSION_COOKIE_NAME)) {
      res.cookies.set(c.name, "", { path: "/", maxAge: 0 })
    }
  }
  return res
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
  const enforceBrand = brandAccessEnforced(SITE_MARKET)
  const isGoogle = currentSub.startsWith("google-oauth2|")

  // EU: without the Management API we cannot prove brand enrollment, so the
  // pending session is ended rather than opened (and the proxy can't loop).
  if (enforceBrand && !management) return endSession(request, "link_unavailable")

  // Build the session facts the planner needs. Identity shape requires the
  // Management record; when Management is off the planner short-circuits to
  // "proceed" before it is ever consulted, so we only fetch when configured.
  // EU fetches it for every sub: brand access is decided from real identities.
  let record: Auth0User | null = null
  if (management && (isGoogle || enforceBrand)) {
    try {
      record = await getUser(currentSub)
    } catch {
      // EU: an unverifiable session fails CLOSED. Elsewhere: we cannot prove a
      // duplicate, so leave the Google session as-is (nothing safe to link onto).
      if (enforceBrand) return endSession(request, "link_unavailable")
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

  // EU (FR/DE): Google may only open an account that is already enrolled in
  // THIS storefront's brand (or a legacy shared account). It never provisions
  // a brand, and never links into an account that lacks this brand's password.
  let brandDenied = false
  if (enforceBrand) {
    const names = resolveConnectionNames()
    const connections = {
      brand: SITE_BRAND === "dewalt" ? names.dewalt : SITE_BRAND === "stanley" ? names.stanley : undefined,
      shared: names.shared,
    }
    if (decision.action === "proceed") {
      brandDenied = !identitiesAuthorizeBrand(record?.identities, connections)
    } else if (decision.action !== "fail-closed") {
      let primary: Auth0User | null = null
      try {
        primary = await getUser(decision.primaryUserId)
      } catch {
        primary = null
      }
      brandDenied = !identitiesAuthorizeBrand(primary?.identities, connections)
    }
  }

  if (brandDenied) {
    if (isGoogle && google.identityCount === 1) {
      await deleteStandaloneGoogleDuplicate(currentSub)
    }
    return endSession(request, "link_unavailable")
  }

  if (decision.action === "proceed") {
    const res = profile()
    // Brand verified server-side: lift the proxy's pending gate on this session.
    if (session && isBrandPending(session.user)) {
      await auth0.updateSession(request, res, {
        ...session,
        user: clearBrandPending(session.user),
      })
    }
    return res
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
