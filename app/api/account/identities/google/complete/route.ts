import { NextResponse, type NextRequest } from "next/server"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import {
  getUser,
  linkIdentity,
  updateUser,
  isManagementConfigured,
  ManagementError,
  type Auth0User,
} from "@/lib/auth0-management"
import {
  resolveRegionAuthConfig,
  regionFromCookieHeader,
} from "@/lib/auth0-regions"
import {
  GOOGLE_LINK_COOKIE_NAME,
  decodeGoogleLinkHandoff,
} from "@/lib/google-link-handoff"

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

// Mirror the password route exactly so the restored session is byte-compatible.
const SESSION_TTL_SECONDS = 60 * 60
const SESSION_COOKIE_NAME = "__session"

type Result = "linked" | "in_use" | "error"

/**
 * Make the just-linked Google account's VERIFIED email a first-class login
 * alias on the primary, so it signs in with the one account password exactly
 * like a linked "email" identity (PR #37). `googleUser` is the standalone
 * Google record read BEFORE linking, so its email + email_verified are the
 * Google account's own. Best-effort: the link already succeeded and is what the
 * customer asked for, so a metadata-write failure must NOT change the outcome.
 * Only app_metadata.login_alias_emails changes — no user create/delete, no
 * password or sub change.
 */
async function recordGoogleAlias(
  primarySub: string,
  googleUser: Auth0User,
): Promise<void> {
  try {
    const googleEmail =
      googleUser.email?.toLowerCase() ??
      (googleUser.identities?.[0]?.profileData?.email as string | undefined)?.toLowerCase()
    const verified =
      googleUser.email_verified === true ||
      googleUser.identities?.[0]?.profileData?.email_verified === true
    if (!googleEmail || !verified) return

    const primary = await getUser(primarySub)
    const existing = Array.isArray(primary.app_metadata?.login_alias_emails)
      ? (primary.app_metadata!.login_alias_emails as unknown[]).filter(
          (e): e is string => typeof e === "string",
        )
      : []
    const merged = Array.from(
      new Set([...existing.map((e) => e.toLowerCase()), googleEmail]),
    )
    if (merged.length === existing.length) return // already present
    await updateUser(primarySub, {
      app_metadata: {
        ...(primary.app_metadata ?? {}),
        login_alias_emails: merged,
      },
    })
  } catch (err) {
    console.log("[v0] google alias persist skipped:", (err as Error).message)
  }
}

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

  // Restore the primary account's session from its Management record. The
  // restored session carries no fresh tokens (we minted it from a directory
  // record, not a login) — only the debug token inspector reads tokenSet, and
  // it tolerates empty tokens; every other reader uses session.user.
  async function restorePrimary(primarySub: string): Promise<string | null> {
    try {
      const primary = await getUser(primarySub)
      const region = regionFromCookieHeader(cookieHeader)
      const { secret } = resolveRegionAuthConfig(region)
      if (!secret) return null
      const now = Math.floor(Date.now() / 1000)
      const session = {
        user: {
          sub: primary.user_id,
          email: primary.email,
          email_verified: primary.email_verified,
          name: primary.name,
          nickname: primary.nickname,
          picture: primary.picture,
          given_name: primary.given_name,
          family_name: primary.family_name,
          updated_at: primary.updated_at,
        },
        tokenSet: {
          accessToken: "",
          idToken: "",
          expiresAt: now + SESSION_TTL_SECONDS,
        },
        internal: { sid: crypto.randomUUID(), createdAt: now },
      }
      return await generateSessionCookie(session, { secret })
    } catch {
      return null
    }
  }

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
  const identities = currentUser.identities ?? []

  // OUTCOME 3 — the Google account is already attached to another customer
  // (its record carries more than one identity). Refuse; never link.
  if (identities.length > 1) {
    return finish("in_use", await restorePrimary(primarySub))
  }

  // OUTCOME 2 — a standalone Google record (the mismatched-email case). Link it
  // onto the primary, using the user_id WITHOUT the "google-oauth2|" prefix,
  // exactly as app/api/account/emails/verify/route.ts links a secondary email.
  const only = identities[0]
  if (identities.length === 1 && only.provider === "google-oauth2") {
    try {
      await linkIdentity(primarySub, {
        provider: "google-oauth2",
        user_id: only.user_id,
      })
      // Promote the Google email to a first-class password alias on the primary
      // (best-effort; never changes the reported link outcome).
      await recordGoogleAlias(primarySub, currentUser)
      return finish("linked", await restorePrimary(primarySub))
    } catch (err) {
      // A 400/409 almost always means it's attached elsewhere — same refusal
      // as the email flow rather than a raw directory error.
      if (
        err instanceof ManagementError &&
        (err.status === 400 || err.status === 409)
      ) {
        return finish("in_use", await restorePrimary(primarySub))
      }
      console.log("[v0] google link failed:", (err as Error).message)
      return finish("error", await restorePrimary(primarySub))
    }
  }

  // Any other shape (e.g. a single non-Google identity) — don't link; just get
  // the person back to their primary session.
  return finish("error", await restorePrimary(primarySub))
}
