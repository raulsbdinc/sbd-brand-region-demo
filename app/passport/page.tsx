import type { Metadata } from "next"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { PassportView } from "@/components/passport-view"

// /passport — SBD Passport, the cross-region account management center.
//
// Like /account, it prefers a real Auth0 session (passing the genuine claims to
// the view). When the Server Component read returns no session, the view itself
// re-probes /api/me before deciding, and otherwise renders a Demo passport
// seeded from the simulated tenant — so the page is useful in every state.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "SBD Passport",
  description:
    "Proof of concept for regional account link records. Cross-region sign-in and session handoff are not built yet.",
}

export default async function PassportPage() {
  let session: { user: Record<string, unknown> } | null = null
  if (isAuthConfigured()) {
    try {
      session = await auth0.getSession()
    } catch {
      session = null
    }
  }

  return <PassportView user={session?.user ?? null} />
}
