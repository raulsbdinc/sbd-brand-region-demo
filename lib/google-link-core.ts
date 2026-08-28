// SHARED GOOGLE-LINK CORE (server-only)
// =====================================
// The link + session-restore + alias mechanics shared by BOTH Google flows:
//   • the explicit signed-in "Connect Google" flow
//     (app/api/account/identities/google/complete)
//   • the cold-login reconcile flow
//     (app/api/signin/google/reconcile/*)
//
// Extracted verbatim from the reviewed complete-route implementation so its
// behaviour is unchanged, and so the reconcile flow links a standalone Google
// record onto a primary EXACTLY the same way. Every function is best-effort
// where the outcome is already decided, and fails closed where it is not.

import "server-only"
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing"
import {
  getUser,
  linkIdentity,
  deleteUser,
  updateUser,
  ManagementError,
  type Auth0User,
} from "@/lib/auth0-management"
import {
  resolveRegionAuthConfig,
  regionFromCookieHeader,
} from "@/lib/auth0-regions"

// Mirror the password route exactly so a restored session is byte-compatible.
export const SESSION_TTL_SECONDS = 60 * 60
export const SESSION_COOKIE_NAME = "__session"

export type GoogleLinkResult = "linked" | "in_use" | "error"

/**
 * Make the just-linked Google account's VERIFIED email a first-class login
 * alias on the primary, so it signs in with the one account password like a
 * linked "email" identity. Best-effort: the link already succeeded, so a
 * metadata-write failure must NOT change the outcome. Only
 * app_metadata.login_alias_emails changes — no user create/delete or sub change.
 */
export async function recordGoogleAlias(
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

/**
 * Link a STANDALONE google-oauth2 record onto `primarySub`. `googleUser` must be
 * the Management record of the current Google session user. Returns:
 *   • "in_use" if that Google record is already attached elsewhere (>1 identity)
 *     or Auth0 rejects the link with 400/409 — NEVER force it.
 *   • "linked" on success (and the Google email is promoted to a login alias).
 *   • "error" for any other shape or directory failure.
 * This performs NO ownership check — the caller MUST have proven ownership of
 * the primary first.
 */
export async function linkStandaloneGoogle(
  primarySub: string,
  googleUser: Auth0User,
): Promise<GoogleLinkResult> {
  const identities = googleUser.identities ?? []
  if (identities.length > 1) return "in_use"

  const only = identities[0]
  if (identities.length === 1 && only.provider === "google-oauth2") {
    try {
      await linkIdentity(primarySub, {
        provider: "google-oauth2",
        user_id: only.user_id,
      })
      await recordGoogleAlias(primarySub, googleUser)
      return "linked"
    } catch (err) {
      if (
        err instanceof ManagementError &&
        (err.status === 400 || err.status === 409)
      ) {
        return "in_use"
      }
      console.log("[v0] google link failed:", (err as Error).message)
      return "error"
    }
  }
  return "error"
}

/**
 * Restore the primary account's session from its Management record, returning a
 * ready-to-set __session cookie value (or null if it can't be minted). The
 * restored session carries no fresh tokens — only the debug token inspector
 * reads tokenSet and tolerates empty tokens; every other reader uses
 * session.user. `cookieHeader` selects the region's shared encryption secret.
 */
export async function mintPrimarySessionCookie(
  primarySub: string,
  cookieHeader: string | null,
): Promise<string | null> {
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
      tokenSet: { accessToken: "", idToken: "", expiresAt: now + SESSION_TTL_SECONDS },
      internal: { sid: crypto.randomUUID(), createdAt: now },
    }
    return await generateSessionCookie(session, { secret })
  } catch {
    return null
  }
}

/**
 * Best-effort removal of a standalone Google DUPLICATE the customer declined to
 * link. Only ever deletes a lone google-oauth2 record — never one that already
 * carries other identities. Failure is swallowed (the session is cleared
 * regardless, so no duplicate is OPERATED even if the record lingers).
 */
export async function deleteStandaloneGoogleDuplicate(googleSub: string): Promise<void> {
  try {
    if (!googleSub.startsWith("google-oauth2|")) return
    const user = await getUser(googleSub)
    const identities = user.identities ?? []
    if (identities.length === 1 && identities[0].provider === "google-oauth2") {
      await deleteUser(googleSub)
    }
  } catch (err) {
    console.log("[v0] standalone google delete skipped:", (err as Error).message)
  }
}
