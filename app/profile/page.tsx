import { auth0, isAuthConfigured } from "@/lib/auth0"
import { extractOtherSites } from "@/lib/claims"
import { AccountClient } from "@/components/account-client"
import { CustomerProfile } from "@/components/customer-profile"
import { ProfileResolver } from "@/components/profile-resolver"

// /profile is the CUSTOMER-facing account page — the projector-friendly view.
//
// It uses exactly the same session-resolution pattern as /account (see
// app/account/page.tsx): a real Auth0 session renders the customer profile;
// configured-but-no-server-session hands off to <ProfileResolver /> (which
// re-checks via /api/me before deciding); and with no integration at all we
// fall back to the mock view. Same guarantees as /account — different body.
//
// The engineer-facing view (token inspection, directory internals, Live tags)
// stays unchanged at /account.
export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  let session: { user: Record<string, unknown> } | null = null
  if (isAuthConfigured()) {
    try {
      session = await auth0.getSession()
    } catch {
      session = null
    }
  }

  if (session?.user) {
    // Read the cross-brand claim here (same as the old welcome page did) and
    // hand it to the customer profile, which renders the recognition panel at
    // the top. Empty on a first-ever site — the panel renders nothing then.
    const otherSites = extractOtherSites(session.user)
    return <CustomerProfile user={session.user} sites={otherSites} />
  }

  if (isAuthConfigured()) {
    return <ProfileResolver />
  }

  return <AccountClient />
}
