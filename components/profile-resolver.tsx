"use client"

import { useEffect } from "react"
import useSWR from "swr"
import { Loader2 } from "lucide-react"
import { CustomerProfile } from "@/components/customer-profile"
import { extractOtherSites } from "@/lib/claims"
import { buildDrawerRedirect } from "@/lib/auth-entry"

// PROFILE RESOLVER (client safety net)
// ====================================
// The customer-profile twin of components/account-resolver.tsx, with the SAME
// guarantees but a different body. Rendered by /profile only when the
// integration is configured but the Server Component's auth0.getSession() read
// returned null. A real session can still exist (Server Component reads can
// transiently miss under concurrent cookie rolling), so we re-check via /api/me
// before falling back to the mock view.
//
// - claims present -> render the customer profile.
// - claims null    -> render the mock view (which redirects if signed out).

interface MeResponse {
  user: { name: string; email: string | null; picture: string | null } | null
  claims: Record<string, unknown> | null
}

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<MeResponse>)

export function ProfileResolver() {
  const { data, isLoading } = useSWR("/api/me", fetcher, {
    revalidateOnFocus: false,
  })

  // Definitively logged out: /api/me resolved with no claims. Send the customer
  // to the storefront root and open the SAME standard drawer in sign-in mode,
  // carrying a safe returnTo=/profile so a successful sign-in lands back here.
  // A full-document navigation (not router.push) guarantees the drawer mounts
  // fresh against the cleaned URL and picks up the ?auth= signal.
  const loggedOut = !isLoading && !data?.claims
  useEffect(() => {
    if (!loggedOut) return
    if (typeof window === "undefined") return
    window.location.assign(
      buildDrawerRedirect({ mode: "sign-in", returnTo: "/profile" }),
    )
  }, [loggedOut])

  if (data?.claims) {
    // Same claim shape as the server session, so the cross-brand panel works on
    // this fallback path too.
    return (
      <CustomerProfile
        user={data.claims}
        sites={extractOtherSites(data.claims)}
      />
    )
  }

  // Both the loading state and the brief pre-redirect logged-out state show the
  // same neutral spinner — no parallel account UI is ever rendered.
  return (
    <main className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading your account…
      </div>
    </main>
  )
}
