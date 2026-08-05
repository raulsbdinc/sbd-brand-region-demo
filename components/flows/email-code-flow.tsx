"use client"

import { useEffect, useRef, useState } from "react"
import { Hash, Loader2, AlertTriangle, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SuccessCheck } from "@/components/success-check"
import { OtpInput } from "@/components/flows/otp-input"
import {
  FlowContainer,
  FlowHeading,
  FlowStep,
  StepIndicator,
} from "@/components/flows/flow-kit"
import { useApp } from "@/components/app-providers"
import type { FlowProps } from "@/components/flow-overlay"
import {
  buildSession,
  generateEmailCode,
  latency,
  looksLikeEmail,
} from "@/lib/auth-service"
import {
  PASSWORDLESS_EMAIL_CONNECTION,
  buildAuthLoginUrl,
  isPasswordlessLive,
  startAuthRedirect,
} from "@/lib/auth0-connections"

// Promoted to real Auth0 passwordless email when the tenant connection is
// enabled (NEXT_PUBLIC_AUTH0_PASSWORDLESS) AND the Auth0 env vars are present.
// In that case the branded intro stays, but entering an email hands off to
// Auth0 Universal Login, which sends and verifies the one-time code itself —
// nothing secret is handled in this app. Otherwise we fall back to the
// cinematic simulation below. The live decision happens before any other hook
// so the two variants keep their own hook lists valid.
export function EmailCodeFlow(props: FlowProps) {
  const { authConfigured } = useApp()
  if (authConfigured && isPasswordlessLive()) {
    return <EmailCodeLive {...props} />
  }
  return <EmailCodeMock {...props} />
}

// REAL AUTH0 FLOW — branded intro, then a full-page redirect to Universal Login
// with the passwordless `email` connection pre-selected.
function EmailCodeLive({ onSwitchMethod }: FlowProps) {
  const [email, setEmail] = useState("")
  const [redirecting, setRedirecting] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!looksLikeEmail(email)) return
    setRedirecting(true)
    // startAuthRedirect breaks out of an embedding iframe (the Auth0 hosted
    // page can't be framed) before hitting the server-mounted /auth/login route.
    startAuthRedirect(
      buildAuthLoginUrl({
        connection: PASSWORDLESS_EMAIL_CONNECTION,
        returnTo: "/profile",
        loginHint: email,
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
              Sending your code…
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              You&apos;ll enter the 6-digit code securely on Auth0 and come right
              back.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      <FlowStep stepKey="email-live">
        <StepIndicator current={1} total={2} />
        <FlowHeading
          title="Sign in with an email code"
          description="Enter your email and we'll hand off to our identity provider, which sends and checks the one-time code on its secure page."
        />
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code-email-live">Email address</Label>
            <Input
              id="code-email-live"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base"
            />
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <Hash className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              The code is sent and verified on the hosted Auth0 / Okta page, then
              you return here signed in.
            </p>
          </div>
          <Button
            type="submit"
            disabled={!looksLikeEmail(email)}
            className="h-12 w-full text-base font-semibold"
          >
            Continue to secure sign-in
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

type Phase = "email" | "code" | "verifying" | "done"

function EmailCodeMock({ onComplete, onSwitchMethod }: FlowProps) {
  const [phase, setPhase] = useState<Phase>("email")
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [otpKey, setOtpKey] = useState(0)
  const start = useRef(Date.now())
  const taps = useRef(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    if (!looksLikeEmail(email)) return
    taps.current += 1
    setSending(true)
    await latency()
    setCode(generateEmailCode())
    setSending(false)
    setPhase("code")
    setCooldown(30)
  }

  async function resend() {
    taps.current += 1
    setCode(generateEmailCode())
    setError(false)
    setOtpKey((k) => k + 1)
    setCooldown(30)
  }

  async function verify(entered: string) {
    taps.current += 1
    if (entered !== code) {
      setError(true)
      setOtpKey((k) => k + 1)
      return
    }
    setError(false)
    setPhase("verifying")
    await latency(500, 800)
    setPhase("done")
    await latency(700, 900)
    onComplete(
      buildSession({
        email,
        method: "email-code",
        metrics: { timeMs: Date.now() - start.current, taps: taps.current },
      }),
    )
  }

  if (phase === "verifying" || phase === "done") {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey={phase}>
          <div className="flex flex-col items-center text-center">
            {phase === "verifying" ? (
              <Loader2 className="mb-6 size-10 animate-spin text-primary" />
            ) : (
              <SuccessCheck className="mb-6" />
            )}
            <h1 className="text-2xl font-bold tracking-tight">
              {phase === "verifying" ? "Checking code…" : "Signed in with email code."}
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              {phase === "verifying"
                ? "Verifying the 6-digit code."
                : "Taking you to your account."}
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  if (phase === "code") {
    return (
      <FlowContainer>
        <FlowStep stepKey="code">
          <FlowHeading
            title={
              <>
                Enter the 6-digit code sent to{" "}
                <span className="text-primary">{email}</span>
              </>
            }
            description="Type the code from your inbox. It submits automatically once all six digits are entered."
          />

          <OtpInput key={otpKey} onComplete={verify} />

          {error ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              That code didn&apos;t match. Check it and try again.
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={resend}
              disabled={cooldown > 0}
              className="h-9"
            >
              Resend code
            </Button>
            <span className="text-xs text-muted-foreground">
              {cooldown > 0
                ? `Resend available in ${cooldown}s`
                : "You can resend the code now"}
            </span>
          </div>

          <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/50 p-3 text-center text-xs text-muted-foreground">
            Simulated delivery — the code sent to this inbox is{" "}
            <span className="font-mono font-semibold text-foreground">{code}</span>
          </div>

          <button
            type="button"
            onClick={onSwitchMethod}
            className="mt-6 w-full rounded text-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Use a different sign-in method
          </button>
        </FlowStep>
      </FlowContainer>
    )
  }

  return (
    <FlowContainer>
      <FlowStep stepKey="email">
        <FlowHeading
          title="Sign in with an email code"
          description="Enter your email and we'll send a one-time 6-digit code to your inbox."
        />
        <form onSubmit={sendCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code-email">Email address</Label>
            <Input
              id="code-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base"
            />
          </div>
          <Button
            type="submit"
            disabled={!looksLikeEmail(email) || sending}
            className="h-12 w-full text-base font-semibold"
          >
            {sending ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Sending code…
              </>
            ) : (
              <>
                <Hash className="size-5" />
                Send 6-digit code
              </>
            )}
          </Button>
        </form>
        <button
          type="button"
          onClick={onSwitchMethod}
          className="mt-6 w-full rounded text-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Use a different sign-in method
        </button>
      </FlowStep>
    </FlowContainer>
  )
}
