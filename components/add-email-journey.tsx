"use client"

import { useState } from "react"
import Link from "next/link"
import { AtSign, KeyRound, Loader2, MailCheck, ShieldCheck, Info, ArrowLeft } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Step = "email" | "verify" | "done"

interface NotReady {
  reason: string
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// Authenticated Model 3 completion: a signed-in per-email customer adds another
// sign-in email to the SAME account. Step 1 emails a one-time code to prove they
// own the address; step 2 verifies the code and sets a password for it. The
// server binds {sub,email} in a signed handoff so the address can't be swapped
// mid-journey.
export function AddEmailJourney() {
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState<NotReady | null>(null)

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/registration/per-email/complete/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.status === 200 && data?.configured === false) {
        setNotReady({ reason: String(data.reason ?? "not-configured") })
        return
      }
      if (res.status === 200 && data?.status === "code-sent") {
        setStep("verify")
        return
      }
      if (res.status === 401) {
        setError("Please sign in again to continue.")
        return
      }
      setError(typeof data?.error === "string" ? data.error : "We couldn't send a code. Please try again.")
    } catch {
      setError("We couldn't send a code. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/registration/per-email/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp, password }),
      })
      const data = await res.json()
      if (res.status === 200 && data?.status === "linked") {
        setStep("done")
        return
      }
      if (res.status === 410) {
        setError("That request expired. Please start again.")
        setStep("email")
        return
      }
      setError(typeof data?.error === "string" ? data.error : "We couldn't verify that. Please try again.")
    } catch {
      setError("We couldn't verify that. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="size-6 text-primary" aria-hidden="true" />
        </span>
        <h1 className="text-balance text-3xl font-bold tracking-tight">
          Add another sign-in email
        </h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          Add a second email and password to your existing account. You&apos;ll
          be able to sign in with either — both lead to the same account.
        </p>
      </header>

      {notReady ? (
        <>
          <Alert>
            <Info />
            <AlertTitle>Not available here yet</AlertTitle>
            <AlertDescription>
              Adding a second sign-in email isn&apos;t enabled for this
              storefront yet ({notReady.reason}). Nothing was changed.
            </AlertDescription>
          </Alert>
          <Button variant="outline" render={<Link href="/profile" />}>
            Back to your account
          </Button>
        </>
      ) : step === "done" ? (
        <>
          <Alert>
            <ShieldCheck />
            <AlertTitle>Email added</AlertTitle>
            <AlertDescription>
              You can now sign in with{" "}
              <strong className="font-semibold text-foreground">{email}</strong>{" "}
              and its new password. It&apos;s connected to your existing account.
            </AlertDescription>
          </Alert>
          <Button render={<Link href="/profile" />}>Back to your account</Button>
        </>
      ) : step === "email" ? (
        <Card>
          <CardHeader>
            <CardTitle>Which email would you like to add?</CardTitle>
            <CardDescription>
              We&apos;ll email a one-time code to confirm it&apos;s yours before
              adding it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-email">Email</Label>
              <div className="relative">
                <AtSign className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="ae-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button onClick={sendCode} disabled={busy || !looksLikeEmail(email)}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              Email me a code
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Confirm and set a password</CardTitle>
            <CardDescription>
              Enter the code we sent to{" "}
              <strong className="font-semibold text-foreground">{email}</strong>{" "}
              and choose a password for this sign-in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-otp">6-digit code</Label>
              <Input
                id="ae-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-password">Password for this email</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="ae-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex items-center gap-3">
              <Button
                onClick={verify}
                disabled={busy || !otp || password.length < 8}
                className="flex-1"
              >
                {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                Add this email
              </Button>
              <Button variant="ghost" onClick={sendCode} disabled={busy}>
                Resend
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 self-start"
              onClick={() => {
                setStep("email")
                setError(null)
              }}
            >
              <ArrowLeft data-icon="inline-start" />
              Use a different email
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
