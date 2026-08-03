"use client"

import { useState } from "react"
import { KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  PASSWORD_CONNECTION,
  buildAuthLoginUrl,
  startAuthRedirect,
} from "@/lib/auth0-connections"
import { looksLikeEmail } from "@/lib/auth-service"

// REAL AUTH0 FLOW
// ===============
// The branded intro is ours, but "Continue" performs a full-page redirect to
// Auth0 Universal Login against the username/password database connection.
// Auth0 hosts the actual password entry (and any MFA the tenant enforces), so
// no credentials are ever typed into this app. An optional email is passed as
// `login_hint` to pre-fill the Auth0 screen. There is no mock fallback: if
// Auth0 isn't configured we say so honestly.
export function PasswordFlow({ onSwitchMethod }: FlowProps) {
  const { authConfigured } = useApp()
  const [email, setEmail] = useState("")
  const [redirecting, setRedirecting] = useState(false)

  if (!authConfigured) {
    return (
      <FlowNotConfigured
        method="Password sign-in"
        onSwitchMethod={onSwitchMethod}
      />
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setRedirecting(true)
    // startAuthRedirect breaks out of an embedding iframe (the Auth0 hosted
    // page can't be framed) before hitting the server-mounted /auth/login route.
    startAuthRedirect(
      buildAuthLoginUrl({
        connection: PASSWORD_CONNECTION,
        returnTo: "/welcome",
        loginHint: looksLikeEmail(email) ? email : undefined,
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
              Taking you to sign in…
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              You&apos;ll enter your password securely on Auth0 and come right
              back.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      <FlowStep stepKey="credentials">
        <StepIndicator current={1} total={2} />
        <FlowHeading
          title="Sign in with email and password"
          description="You'll enter your password securely on our identity provider's hosted page — SBD never sees it."
        />
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw-email">Email address (optional)</Label>
            <Input
              id="pw-email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base"
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll pre-fill this on the sign-in screen to save you a step.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your password and any additional verification are handled on the
              hosted Auth0 / Okta page, then you return here signed in.
            </p>
          </div>

          <Button type="submit" className="h-12 w-full text-base font-semibold">
            {redirecting ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Redirecting…
              </>
            ) : (
              "Continue to secure sign-in"
            )}
          </Button>
        </form>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Brokered through Auth0 / Okta — a real redirect login.
        </p>
        <button
          type="button"
          onClick={onSwitchMethod}
          className="mt-3 w-full rounded text-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Use a different sign-in method
        </button>
      </FlowStep>
    </FlowContainer>
  )
}
