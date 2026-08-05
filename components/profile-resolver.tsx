"use client"

import useSWR from "swr"
import { Loader2 } from "lucide-react"
import { CustomerProfile } from "@/components/customer-profile"
import { AccountClient } from "@/components/account-client"
import { extractOtherSites } from "@/lib/claims"

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

  if (isLoading) {
    return (
      <main className="flex min-h-[60vh] w-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your account…
        </div>
      </main>
    )
  }

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

  return <AccountClient />
}
