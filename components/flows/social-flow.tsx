"use client"

import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { Code2, Loader2, Lock, ShieldCheck } from "lucide-react"
import { useApp } from "@/components/app-providers"
import {
  FlowContainer,
  FlowHeading,
  FlowNotConfigured,
  FlowStep,
  StepIndicator,
} from "@/components/flows/flow-kit"
import type { FlowProps } from "@/components/flow-overlay"
import {
  SOCIAL_CONNECTIONS,
  buildAuthLoginUrl,
  startAuthRedirect,
  getLiveSocialProviders,
} from "@/lib/auth0-connections"
import type { SocialProvider } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ProviderMeta {
  id: SocialProvider
  hue: string
  /** Glyph node rendered inside the provider badge. */
  glyph: ReactNode
}

const PROVIDERS: ProviderMeta[] = [
  { id: "Google", hue: "#ea4335", glyph: "G" },
  { id: "Apple", hue: "#111111", glyph: "A" },
  { id: "Microsoft", hue: "#0078d4", glyph: "M" },
  { id: "Facebook", hue: "#1877f2", glyph: "f" },
  { id: "GitHub", hue: "#111111", glyph: <Code2 className="size-5" /> },
  { id: "LinkedIn", hue: "#0a66c2", glyph: "in" },
  { id: "X", hue: "#000000", glyph: "X" },
]

// REAL AUTH0 FLOW
// ===============
// The branded provider picker below is ours, but selecting a provider performs
// a full-page redirect to Auth0 Universal Login with `connection` pre-selected,
// so the user goes straight to that provider's consent screen. After a real
// login they return to /welcome with a signed session. There is no mock
// fallback: if Auth0 isn't configured we say so honestly.
export function SocialFlow({ onSwitchMethod }: FlowProps) {
  const { authConfigured } = useApp()
  const [redirecting, setRedirecting] = useState<SocialProvider | null>(null)

  // Live providers (verified working on the tenant) are clickable and badged;
  // the rest render disabled with a "Not configured" tag. Live ones float to
  // the top so testers reach a working option first.
  const liveProviders = useMemo(() => getLiveSocialProviders(), [])
  const orderedProviders = useMemo(() => {
    const isLive = (id: SocialProvider) => liveProviders.includes(id)
    return [...PROVIDERS].sort(
      (a, b) => Number(isLive(b.id)) - Number(isLive(a.id)),
    )
  }, [liveProviders])

  if (!authConfigured) {
    return (
      <FlowNotConfigured
        method="Social sign-in"
        onSwitchMethod={onSwitchMethod}
      />
    )
  }

  function pick(id: SocialProvider) {
    if (!liveProviders.includes(id)) return
    setRedirecting(id)
    // startAuthRedirect breaks out of an embedding iframe (the Auth0 hosted
    // page can't be framed) before hitting the server-mounted /auth/login route.
    startAuthRedirect(
      buildAuthLoginUrl({
        connection: SOCIAL_CONNECTIONS[id],
        returnTo: "/profile",
      }),
    )
  }

  if (redirecting) {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey="redirecting">
          <div className="flex flex-col items-center text-center">
            <Loader2 className="mb-6 size-10 animate-spin text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              Continuing with {redirecting}…
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Redirecting you to sign in securely. You&apos;ll come right back.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      <FlowStep stepKey="choose">
        <StepIndicator current={1} total={2} />
        <FlowHeading
          title="Continue with a provider"
          description="Authorize a trusted account. SBD never sees or stores your provider password."
        />
        <div className="space-y-2.5">
          {orderedProviders.map((p) => {
            const live = liveProviders.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id)}
                disabled={!live || redirecting !== null}
                aria-disabled={!live}
                title={
                  live
                    ? `Continue with ${p.id}`
                    : `${p.id} is not configured on this tenant yet`
                }
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  live
                    ? "transition-colors hover:bg-muted disabled:opacity-60"
                    : "cursor-not-allowed opacity-55",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: p.hue }}
                >
                  {p.glyph}
                </span>
                <span className="flex-1 text-base font-medium text-foreground">
                  Continue with {p.id}
                </span>
                {live ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                    <ShieldCheck className="size-3" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <Lock className="size-3" />
                    Not configured
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Brokered through Auth0 / Okta — a real redirect login.
        </p>
        <button
          type="button"
          onClick={onSwitchMethod}
          className="mt-3 w-full text-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Use a different method.
        </button>
      </FlowStep>
    </FlowContainer>
  )
}
