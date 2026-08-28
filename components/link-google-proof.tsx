"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, MailCheck, ShieldCheck, Loader2 } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Summary {
  pending: boolean
  maskedEmail?: string
  methods?: string[]
}

// Cold-Google reconcile proof UI. A visitor signed in with Google whose email
// already belongs to an existing account; before we connect Google we make them
// prove ownership of that account (its password OR a one-time email code). On
// success the server links Google and swaps us into the primary session; on
// decline we sign out so no duplicate is ever operated.
export function LinkGoogleProof() {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tab, setTab] = useState<"password" | "code">("password")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/signin/google/reconcile/proof")
      .then((r) => r.json())
      .then((data: Summary) => setSummary(data))
      .catch(() => setSummary({ pending: false }))
  }, [])

  async function sendCode() {
    setSending(true)
    setError(null)
    try {
      await fetch("/api/signin/google/reconcile/proof/start", { method: "POST" })
      // Neutral by design — the endpoint never reveals whether a message was
      // actually sent, so we always move the UI to the "enter code" state.
      setCodeSent(true)
    } catch {
      setError("We couldn't start that. Please try again.")
    } finally {
      setSending(false)
    }
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/signin/google/reconcile/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          tab === "password" ? { method: "password", password } : { method: "code", code },
        ),
      })
      const data = await res.json()
      if (res.ok && data?.ok) {
        router.push(typeof data.redirect === "string" ? data.redirect : "/profile")
        return
      }
      setError(typeof data?.error === "string" ? data.error : "We couldn't verify that. Please try again.")
    } catch {
      setError("We couldn't verify that. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  async function decline() {
    setSubmitting(true)
    try {
      await fetch("/api/signin/google/reconcile/cancel", { method: "POST" })
    } finally {
      window.location.href = "/"
    }
  }

  if (summary === null) {
    return (
      <main className="mx-auto flex w-full max-w-lg items-center justify-center px-4 py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </main>
    )
  }

  if (!summary.pending) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 sm:px-6">
        <Alert>
          <ShieldCheck />
          <AlertTitle>Nothing to confirm right now</AlertTitle>
          <AlertDescription>
            This verification link has expired or was already used. Please sign
            in again to continue.
          </AlertDescription>
        </Alert>
        <Button className="mt-6" onClick={() => (window.location.href = "/auth/login")}>
          Back to sign-in
        </Button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="size-7 text-primary" aria-hidden="true" />
        </span>
        <h1 className="text-balance text-3xl font-bold tracking-tight">
          Confirm it&apos;s you to connect Google
        </h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          You already have an account for{" "}
          <strong className="font-semibold text-foreground">
            {summary.maskedEmail}
          </strong>
          . To keep everything under one account — and avoid creating a
          duplicate — confirm you own it and we&apos;ll connect Google to it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verify ownership</CardTitle>
          <CardDescription>
            Use your existing account password, or send a one-time code to your
            email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => { setTab(v as "password" | "code"); setError(null) }}>
            <TabsList className="w-full">
              <TabsTrigger value="password" className="flex-1">
                <KeyRound data-icon="inline-start" />
                Password
              </TabsTrigger>
              <TabsTrigger value="code" className="flex-1">
                <MailCheck data-icon="inline-start" />
                Email code
              </TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lg-password">Account password</Label>
                <Input
                  id="lg-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && password) submit()
                  }}
                />
              </div>
              <Button onClick={submit} disabled={submitting || !password}>
                {submitting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                Verify and connect Google
              </Button>
            </TabsContent>

            <TabsContent value="code" className="mt-4 flex flex-col gap-3">
              {!codeSent ? (
                <Button variant="outline" onClick={sendCode} disabled={sending}>
                  {sending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <MailCheck data-icon="inline-start" />}
                  Email me a one-time code
                </Button>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="lg-code">Enter the 6-digit code</Label>
                    <Input
                      id="lg-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && code) submit()
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={submit} disabled={submitting || !code} className="flex-1">
                      {submitting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                      Verify and connect Google
                    </Button>
                    <Button variant="ghost" onClick={sendCode} disabled={sending}>
                      Resend
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          {error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">
          Not your account, or prefer not to connect Google?
        </p>
        <Button variant="ghost" onClick={decline} disabled={submitting}>
          Cancel and sign out
        </Button>
      </div>
    </main>
  )
}
