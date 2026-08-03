import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import { sanitizeConsent } from "@/lib/metadata-schema"
import { diffConsent, recordConsentChanges } from "@/lib/consent-audit"

// /api/account/consent
//   GET   → the signed-in user's current consent state, read from
//           `user_metadata.consent` and merged over defaults, plus the
//           `consent_updated_at` stamp (when present).
//   PATCH → write consent back to `user_metadata.consent`. The body is run
//           through the schema allow-list (lib/metadata-schema) so ONLY known
//           consent topics with boolean values are stored.
//
// IMPORTANT: this writes ONLY the `consent` key (+ a `consent_updated_at`
// stamp). Auth0 shallow-merges top-level user_metadata keys, so the user's
// Site preferences (preferred_brand, locale, communication_prefs, …) are left
// untouched — the two write paths never clobber each other.
//
// This persists the current state plus a last-updated timestamp. The route also
// attempts a best-effort append to Neon. Logging failures do not block the state
// save, so this POC does not promise a complete audit record.
export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const user = await getUser(guard.user.sub)
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    return NextResponse.json({
      configured: true,
      consent: sanitizeConsent(meta.consent),
      updatedAt: typeof meta.consent_updated_at === "string" ? meta.consent_updated_at : null,
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Allow-list + normalize. Anything not a known consent topic is dropped here.
  const consent = sanitizeConsent(body)
  const updatedAt = new Date().toISOString()

  try {
    // Read the CURRENT consent first so we can diff it against the incoming
    // state and record exactly what changed in the append-only audit trail.
    let previous: ReturnType<typeof sanitizeConsent> | null = null
    try {
      const before = await getUser(guard.user.sub)
      const beforeMeta = (before.user_metadata ?? {}) as Record<string, unknown>
      previous = sanitizeConsent(beforeMeta.consent)
    } catch {
      // If the pre-read fails we still save; the diff just treats it as no
      // baseline (only grants get logged).
      previous = null
    }

    // Shallow-merge: only `consent` + `consent_updated_at` are written; all
    // other user_metadata keys (site preferences) are preserved by Auth0.
    const user = await updateUser(guard.user.sub, {
      user_metadata: { consent, consent_updated_at: updatedAt },
    })

    // Auth0 metadata now holds the current state. Try to append the per-topic
    // changes to Neon. A logging failure does not fail the user's save.
    await recordConsentChanges(guard.user.sub, diffConsent(previous, consent))

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    return NextResponse.json({
      configured: true,
      consent: sanitizeConsent(meta.consent),
      updatedAt:
        typeof meta.consent_updated_at === "string" ? meta.consent_updated_at : updatedAt,
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
