"use client"

import useSWR from "swr"
import { Loader2 } from "lucide-react"
import { RealAccount } from "@/components/real-account"
import { AccountClient } from "@/components/account-client"

// ACCOUNT RESOLVER (client safety net)
// ====================================
// Rendered by /account only when the integration is configured but the
// Server Component's auth0.getSession() read returned null. A real session can
// still exist — Server Component session reads can transiently miss under
// concurrent cookie rolling — so before falling back to the mock account view
// (which redirects signed-out users to /pathways), we re-check the session via
// the /api/me route handler, which reads the session cookie reliably.
//
// - claims present  -> a real session exists, render the real account center.
// - claims null     -> genuinely signed out, render the mock view (which
//                      redirects to /pathways if there's no mock session either).

interface MeResponse {
  user: { name: string; email: string | null; picture: string | null } | null
  claims: Record<string, unknown> | null
}

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<MeResponse>)

export function AccountResolver() {
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
    return <RealAccount user={data.claims} />
  }

  return <AccountClient />
}
