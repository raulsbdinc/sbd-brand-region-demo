"use client"

import { useRef, useState } from "react"
import { Fingerprint } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SuccessCheck } from "@/components/success-check"
import { FlowContainer, FlowHeading, FlowStep } from "@/components/flows/flow-kit"
import type { FlowProps } from "@/components/flow-overlay"
import { buildSession, latency, looksLikeEmail } from "@/lib/auth-service"

type Phase = "email" | "verifying" | "done"

export function PasskeyFlow({ onComplete, onSwitchMethod }: FlowProps) {
  const [phase, setPhase] = useState<Phase>("email")
  const [email, setEmail] = useState("")
  const start = useRef(Date.now())
  const taps = useRef(0)

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault()
    if (!looksLikeEmail(email)) return
    taps.current += 1
    setPhase("verifying")
    await latency(1400, 1700) // biometric prompt + assertion
    setPhase("done")
    await latency(700, 900)
    onComplete(
      buildSession({
        email,
        method: "passkey",
        metrics: {
          timeMs: Date.now() - start.current,
          taps: taps.current,
        },
      }),
    )
  }

  if (phase === "verifying") {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey="verifying">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-8 flex size-28 items-center justify-center">
              <span className="sbd-pulse-ring absolute inset-0 rounded-full bg-primary/40" />
              <span className="flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Fingerprint className="size-12" />
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Auth0 passkey challenge
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Walkthrough only: in production, Auth0 invokes the device&apos;s WebAuthn prompt and verifies the credential. SBD never receives biometric data.
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
              Passkey journey complete
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              This explainer shows the handoff. Auth0 performs real enrollment, challenge, and authentication when passkeys are enabled for the tenant.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      <FlowStep stepKey="email">
        <FlowHeading
          title="How passkey sign-in works"
          description="An Auth0-managed walkthrough: the device verifies the customer locally, no password is sent, and SBD never handles the credential or biometric."
        />
        <form onSubmit={handleContinue} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="passkey-email">Email address</Label>
            <Input
              id="passkey-email"
              type="email"
              autoComplete="username webauthn"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base"
            />
          </div>
          <Button
            type="submit"
            disabled={!looksLikeEmail(email)}
            className="h-12 w-full text-base font-semibold"
          >
            <Fingerprint className="size-5" />
            Continue with passkey
          </Button>
        </form>
        <button
          type="button"
          onClick={onSwitchMethod}
          className="mt-6 w-full text-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          No passkey on this device? Choose another method.
        </button>
      </FlowStep>
    </FlowContainer>
  )
}
