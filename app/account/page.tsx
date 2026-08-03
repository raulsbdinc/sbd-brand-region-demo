import { auth0, isAuthConfigured } from "@/lib/auth0"
import { AccountClient } from "@/components/account-client"
import { RealAccount } from "@/components/real-account"
import { AccountResolver } from "@/components/account-resolver"

// /account is the unified account center.
//
// - After a promoted REAL login (social, password) or the "Try it live" flow,
//   a signed Auth0 session cookie is present and we render <RealAccount /> with
//   the genuine ID-token claims plus the (simulated) management surface.
// - If the integration is configured but this Server Component read returns no
//   session, we hand off to <AccountResolver />, which re-checks via the
//   /api/me route handler before deciding — this prevents a transient
//   Server-Component session miss from wrongly bouncing a real user to
//   /pathways.
// - The SIMULATED flows (passkey, magic link, email code, SSO, QR) have no
//   server session; they fall back to <AccountClient />, which reads the
//   client-side mock session and redirects to /pathways if there is none.
export const dynamic = "force-dynamic"

export default async function AccountPage() {
  let session: { user: Record<string, unknown> } | null = null
  if (isAuthConfigured()) {
    try {
      session = await auth0.getSession()
    } catch {
      session = null
    }
  }

  if (session?.user) {
    return <RealAccount user={session.user} />
  }

  // Configured but no server session detected: re-verify client-side before
  // falling back to the mock view (which redirects signed-out users).
  if (isAuthConfigured()) {
    return <AccountResolver />
  }

  return <AccountClient />
}
