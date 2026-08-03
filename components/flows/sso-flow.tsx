"use client"

import { useRef, useState } from "react"
import { Building2, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SuccessCheck } from "@/components/success-check"
import {
  FlowContainer,
  FlowHeading,
  FlowStep,
  StepIndicator,
} from "@/components/flows/flow-kit"
import type { FlowProps } from "@/components/flow-overlay"
import { buildSession, isCorporateEmail, latency, looksLikeEmail } from "@/lib/auth-service"

type Phase = "email" | "redirect" | "entra" | "done"

export function SsoFlow({ onComplete, onSwitchMethod }: FlowProps) {
  const [phase, setPhase] = useState<Phase>("email")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const start = useRef(Date.now())
  const taps = useRef(0)

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!looksLikeEmail(email)) return
    if (!isCorporateEmail(email)) {
      setError("SSO is only available for @sbdinc.com work accounts.")
      return
    }
    setError(null)
    taps.current += 1
    setPhase("redirect")
    await latency(1100, 1500) // redirect to IdP
    setPhase("entra")
  }

  async function approve() {
    taps.current += 1
    await latency(900, 1200) // work sign-in + policy check
    setPhase("done")
    await latency(700, 900)
    onComplete(
      buildSession({
        email,
        method: "sso",
        provider: "Entra ID",
        roles: ["customer", "employee"],
        metrics: { timeMs: Date.now() - start.current, taps: taps.current },
      }),
    )
  }

  if (phase === "redirect") {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey="redirect">
          <div className="flex flex-col items-center text-center">
            <Loader2 className="mb-6 size-12 animate-spin text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              Redirecting to your work sign-in
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Sending you to Microsoft Entra ID to continue securely.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  if (phase === "done") {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey="done">
          <div className="flex flex-col items-center text-center">
            <SuccessCheck className="mb-6" />
            <h1 className="text-2xl font-bold tracking-tight">
              Signed in with your work account.
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Employee access granted via Entra ID.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  if (phase === "entra") {
    return (
      <FlowContainer>
        <FlowStep stepKey="entra">
          <StepIndicator current={2} total={2} />
          {/* Simulated corporate IdP screen with a distinct chrome */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted px-5 py-3">
              <span className="grid grid-cols-2 gap-0.5" aria-hidden>
                <span className="size-2 bg-[#f25022]" />
                <span className="size-2 bg-[#7fba00]" />
                <span className="size-2 bg-[#00a4ef]" />
                <span className="size-2 bg-[#ffb900]" />
              </span>
              <span className="text-sm font-semibold text-foreground">Microsoft Entra ID</span>
            </div>
            <div className="px-5 py-6">
              <p className="text-sm text-muted-foreground">Signing in to</p>
              <p className="text-base font-semibold text-foreground">SBD Storefront</p>
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-muted p-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Building2 className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{email}</p>
                  <p className="text-xs text-muted-foreground">Stanley Black &amp; Decker, Inc.</p>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Your organization requires you to sign in to access this app. Conditional
                  access policies will be evaluated.
                </span>
              </div>
              <Button onClick={approve} className="mt-5 h-12 w-full text-base font-semibold">
                Continue as employee
              </Button>
            </div>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      <FlowStep stepKey="email">
        <StepIndicator current={1} total={2} />
        <FlowHeading
          title="Employee single sign-on"
          description="Use your SBD work account. You'll be redirected to Microsoft Entra ID."
        />
        <form onSubmit={handleEmail} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sso-email">Work email</Label>
            <Input
              id="sso-email"
              type="email"
              autoComplete="username"
              placeholder="you@sbdinc.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
              className="h-12 text-base"
            />
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Tip: try any address ending in @sbdinc.com
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={!looksLikeEmail(email)}
            className="h-12 w-full text-base font-semibold"
          >
            <Building2 className="size-5" />
            Continue with work account
          </Button>
        </form>
        <button
          type="button"
          onClick={onSwitchMethod}
          className="mt-6 w-full text-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Not an employee? Choose another method.
        </button>
      </FlowStep>
    </FlowContainer>
  )
}
