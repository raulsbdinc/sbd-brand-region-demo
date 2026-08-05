"use client"

import { useRef, useState } from "react"
import { motion } from "motion/react"
import {
  Mail,
  Inbox,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SuccessCheck } from "@/components/success-check"
import { useApp, useBrand } from "@/components/app-providers"
import {
  FlowContainer,
  FlowHeading,
  FlowStep,
  StepIndicator,
} from "@/components/flows/flow-kit"
import type { FlowProps } from "@/components/flow-overlay"
import {
  buildSession,
  generateLinkToken,
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
// The branded intro stays, then we hand off to Auth0 Universal Login on the
// shared `email` connection (which delivers the one-time link/code). Otherwise
// we fall back to the cinematic simulation below. The live decision runs before
// any other hook so each variant keeps its own hook list valid.
export function MagicLinkFlow(props: FlowProps) {
  const { authConfigured } = useApp()
  if (authConfigured && isPasswordlessLive()) {
    return <MagicLinkLive {...props} />
  }
  return <MagicLinkMock {...props} />
}

// REAL AUTH0 FLOW — branded intro, then a full-page redirect to Universal Login
// with the passwordless `email` connection pre-selected.
function MagicLinkLive({ onSwitchMethod }: FlowProps) {
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
              Sending your link…
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              You&apos;ll finish signing in securely on Auth0 and come right
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
          title="Sign in with a magic link"
          description="Enter your email and we'll hand off to our identity provider, which sends the one-time sign-in link from its secure page."
        />
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="magic-email-live">Email address</Label>
            <Input
              id="magic-email-live"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base"
            />
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <Mail className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              The sign-in link is issued and verified by the hosted Auth0 / Okta
              page, then you return here signed in.
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

type Phase = "email" | "sent" | "opening" | "done"

function MagicLinkMock({ onComplete, onSwitchMethod }: FlowProps) {
  const brand = useBrand()
  const [phase, setPhase] = useState<Phase>("email")
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [token, setToken] = useState("")
  const [linkUsed, setLinkUsed] = useState(false)
  const [showUsedNotice, setShowUsedNotice] = useState(false)
  const start = useRef(Date.now())
  const taps = useRef(0)

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault()
    if (!looksLikeEmail(email)) return
    taps.current += 1
    setSending(true)
    await latency()
    setToken(generateLinkToken())
    setLinkUsed(false)
    setShowUsedNotice(false)
    setSending(false)
    setPhase("sent")
  }

  async function openLink() {
    taps.current += 1
    if (linkUsed) {
      setShowUsedNotice(true)
      return
    }
    setLinkUsed(true)
    setPhase("opening")
    await latency(600, 1000)
    setPhase("done")
    await latency(700, 900)
    onComplete(
      buildSession({
        email,
        method: "magic-link",
        metrics: { timeMs: Date.now() - start.current, taps: taps.current },
      }),
    )
  }

  async function requestNew() {
    taps.current += 1
    await sendLink()
  }

  if (phase === "opening") {
    return (
      <FlowContainer className="flex items-center">
        <FlowStep stepKey="opening">
          <div className="flex flex-col items-center text-center">
            <Loader2 className="mb-6 size-10 animate-spin text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Opening link…</h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Verifying the one-time link and signing you in.
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
              Signed in with the link.
            </h1>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Taking you to your account.
            </p>
          </div>
        </FlowStep>
      </FlowContainer>
    )
  }

  if (phase === "sent") {
    return (
      <FlowContainer>
        <FlowStep stepKey="sent">
          <FlowHeading
            title={
              <>
                Sign-in link sent to{" "}
                <span className="text-primary">{email}</span>
              </>
            }
            description="Open the link in the inbox below to continue. The link can be used only once."
          />

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
              <Inbox className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Simulated inbox</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {email}
              </span>
            </div>
            <div className="p-4">
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs text-muted-foreground">
                  From: no-reply@login.sbdinc.com
                </p>
                <p className="mt-1 font-semibold">
                  Your sign-in link for {brand.name}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Use the button below to finish signing in. This link expires
                  after it is opened once.
                </p>
                <Button
                  type="button"
                  onClick={openLink}
                  className="mt-4 h-11 w-full text-base font-semibold"
                >
                  <ExternalLink className="size-4" />
                  Sign in to {brand.name}
                </Button>
                {linkUsed ? (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    This link has been opened.
                  </p>
                ) : null}
              </div>
            </div>
          </motion.div>

          {showUsedNotice ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  This link has already been used. Request a new one.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestNew}
                  className="h-9"
                >
                  Request a new link
                </Button>
              </div>
            </motion.div>
          ) : null}

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
          title="Sign in with a magic link"
          description="Enter your email and we'll send a one-time sign-in link to your inbox."
        />
        <form onSubmit={sendLink} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="magic-email">Email address</Label>
            <Input
              id="magic-email"
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
                Sending link…
              </>
            ) : (
              <>
                <Mail className="size-5" />
                Send sign-in link
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
