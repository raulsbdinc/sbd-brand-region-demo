"use client"

import Link from "next/link"
import { useState } from "react"
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  MailSearch,
  ShieldCheck,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type RecoveryIntent = "password" | "account"

const OPTIONS: Array<{
  id: RecoveryIntent
  title: string
  description: string
  icon: typeof KeyRound
}> = [
  {
    id: "password",
    title: "Reset password",
    description: "Get a secure link for an email-and-password account.",
    icon: KeyRound,
  },
  {
    id: "account",
    title: "Find my account",
    description: "Use your email to recover the account identifier you sign in with.",
    icon: MailSearch,
  },
]

export function RecoveryCenter({ initialEmail = "" }: { initialEmail?: string }) {
  const [intent, setIntent] = useState<RecoveryIntent>("password")
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const response = await fetch("/api/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, intent }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? "Enter a valid email address.")
        return
      }
      setComplete(true)
    } catch {
      setError("We could not start recovery. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (complete) {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Request received
        </p>
        <h1 className="mt-2 text-balance text-3xl font-bold tracking-tight">
          Check your inbox
        </h1>
        <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          If an eligible account uses that email, recovery instructions are on the
          way. For your privacy, we cannot confirm whether an account was found.
        </p>
        <div className="mt-7 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/signin" className={buttonVariants()}>
            Return to sign in
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              setComplete(false)
              setEmail("")
            }}
          >
            Try another email
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Link
        href="/signin"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to sign in
      </Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Account help
      </p>
      <h1 className="mt-2 text-balance text-3xl font-bold tracking-tight">
        Recover your SBD account
      </h1>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
        Choose what you need. We use the same private confirmation for every
        request, so account details are never exposed.
      </p>

      <div className="mt-7 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Recovery option">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const active = intent === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setIntent(option.id)}
              className={cn(
                "rounded-xl border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/50",
              )}
            >
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <span className="mt-3 block text-sm font-semibold text-foreground">
                {option.title}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {option.description}
              </span>
            </button>
          )
        })}
      </div>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-email">Email address</Label>
          <Input
            id="recovery-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(error)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Send recovery instructions
        </Button>
      </form>

      <div className="mt-7 flex items-start gap-3 rounded-xl bg-muted p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Social sign-in accounts are recovered through their original provider.
          We will never reveal which sign-in method is attached to an email.
        </p>
      </div>
    </div>
  )
}
