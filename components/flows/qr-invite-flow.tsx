"use client"

import { useEffect, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { BadgeCheck, ScanLine } from "lucide-react"
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
import { PasswordRules } from "@/components/flows/password-rules"
import type { FlowProps } from "@/components/flow-overlay"
import {
  allPasswordRulesPass,
  buildSession,
  generateLinkToken,
  latency,
} from "@/lib/auth-service"

type Phase = "qr" | "scanning" | "details" | "done"

// MOCK: a counter-issued invite payload encoded in the QR.
const INVITE = {
  token: generateLinkToken(),
  email: "pro.member@worksite.example",
  role: "pro-member",
  store: "Store #4821 — Pro Desk",
}

export function QrInviteFlow({ onComplete, onSwitchMethod }: FlowProps) {
  const [phase, setPhase] = useState<Phase>("qr")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const start = useRef(Date.now())
  const taps = useRef(0)

  // MOCK: auto-advance from the displayed QR to a simulated scan.
  useEffect(() => {
    if (phase !== "scanning") return
    let active = true
    ;(async () => {
      await latency(1600, 2000)
      if (active) setPhase("details")
    })()
    return () => {
      active = false
    }
  }, [phase])

  async function finish(e: React.FormEvent) {
    e.preventDefault()
    if (!allPasswordRulesPass(password)) return
    taps.current += 1
    await latency(500, 800)
    setPhase("done")
    await latency(700, 900)
    onComplete(
      buildSession({
        email: INVITE.email,
        method: "qr",
        roles: ["customer", INVITE.role],
        metrics: { timeMs: Date.now() - start.current, taps: taps.current },
      }),
    )
  }

  if (phase === "done") {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey="done">
          <div className="flex flex-col items-center text-center">
            <SuccessCheck className="mb-6" />
            <h1 className="text-2xl font-bold tracking-tight">Account created.</h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              You&apos;re signed in with the <strong>{INVITE.role}</strong> role.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      {phase === "qr" && (
        <FlowStep stepKey="qr">
          <StepIndicator current={1} total={3} />
          <FlowHeading
            title="Scan your counter invite"
            description="A team member issued this QR at the Pro Desk. Scan it to claim your preassigned account."
          />
          <div className="flex flex-col items-center">
            <div className="relative rounded-2xl border border-border bg-card p-6">
              <QRCodeSVG
                value={`https://usn.dewalt.com?invite=${INVITE.token}&role=${INVITE.role}`}
                size={208}
                level="M"
                marginSize={0}
                bgColor="transparent"
                fgColor="currentColor"
                className="text-foreground"
              />
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <BadgeCheck className="size-4 text-primary" />
              {INVITE.store}
            </div>
          </div>
          <Button
            onClick={() => {
              taps.current += 1
              setPhase("scanning")
            }}
            className="mt-6 h-12 w-full text-base font-semibold"
          >
            <ScanLine className="size-5" />
            Simulate scan
          </Button>
          <button
            type="button"
            onClick={onSwitchMethod}
            className="mt-6 w-full text-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            No invite code? Choose another method.
          </button>
        </FlowStep>
      )}

      {phase === "scanning" && (
        <FlowStep stepKey="scanning">
          <StepIndicator current={2} total={3} />
          <FlowHeading title="Reading invite…" description="Verifying the counter-issued code." />
          <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-border bg-muted">
            <div className="absolute inset-6 rounded-xl border-2 border-dashed border-primary/50" />
            <div className="sbd-scan-line absolute inset-x-6 h-0.5 bg-primary shadow-[0_0_12px_var(--brand)]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <ScanLine className="size-10 text-primary/70" />
            </div>
          </div>
        </FlowStep>
      )}

      {phase === "details" && (
        <FlowStep stepKey="details">
          <StepIndicator current={3} total={3} />
          <FlowHeading
            title="Set up your account"
            description="Your invite is verified. Create a password to finish."
          />
          <div className="mb-4 rounded-xl border border-border bg-card p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate font-medium text-foreground">{INVITE.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Preassigned role</dt>
                <dd className="font-medium text-foreground">{INVITE.role}</dd>
              </div>
            </dl>
          </div>
          <form onSubmit={finish} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qr-password">Create a password</Label>
              <div className="relative">
                <Input
                  id="qr-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pr-16 text-base"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute inset-y-0 right-0 px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <PasswordRules password={password} />
            <Button
              type="submit"
              disabled={!allPasswordRulesPass(password)}
              className="h-12 w-full text-base font-semibold"
            >
              Create account
            </Button>
          </form>
        </FlowStep>
      )}
    </FlowContainer>
  )
}
