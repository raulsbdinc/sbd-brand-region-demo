"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, BadgeCheck, CircleDashed, MailCheck, UserRoundCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  REGISTRATION_CONFIG,
  REGISTRATION_STORAGE_KEY,
  sanitizePendingRegistration,
  type PendingRegistration,
} from "@/lib/registration"

interface SessionState {
  signedIn: boolean
  emailVerified: boolean
}

export function RegistrationCompletion() {
  const [pending, setPending] = useState<PendingRegistration | null>(null)
  const [session, setSession] = useState<SessionState>({ signedIn: false, emailVerified: false })
  const [receiptMode, setReceiptMode] = useState<"checking" | "live" | "demo">("checking")

  useEffect(() => {
    const raw = sessionStorage.getItem(REGISTRATION_STORAGE_KEY)
    if (raw) {
      try { setPending(sanitizePendingRegistration(JSON.parse(raw))) } catch { setPending(null) }
    }
    fetch("/api/me")
      .then((response) => response.json())
      .then(async (data) => {
        const claims = data?.claims as Record<string, unknown> | null
        const signedIn = Boolean(data?.user)
        setSession({ signedIn, emailVerified: claims?.email_verified === true })
        if (!signedIn || !raw) { setReceiptMode("demo"); return }
        const registration = sanitizePendingRegistration(JSON.parse(raw))
        if (!registration) { setReceiptMode("demo"); return }
        const response = await fetch("/api/account/registration-receipt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(registration),
        })
        const result = await response.json()
        setReceiptMode(response.ok && result.configured ? "live" : "demo")
      })
      .catch(() => setReceiptMode("demo"))
  }, [])

  if (!pending) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <Alert><CircleDashed /><AlertTitle>No registration journey is pending</AlertTitle><AlertDescription>Start from one of the contextual entry points so this page can show the correct onboarding tasks.</AlertDescription></Alert>
        <Button className="mt-6" nativeButton={false} render={<Link href="/register" />}>Choose an entry point</Button>
      </main>
    )
  }

  const config = REGISTRATION_CONFIG[pending.entryPoint]
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3 text-center">
        <Badge variant="secondary" className="self-center">{receiptMode === "live" ? "Live receipt saved" : receiptMode === "checking" ? "Checking session" : "Demo receipt"}</Badge>
        <h1 className="text-balance text-4xl font-bold tracking-tight">{config.completionTitle}</h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">{config.completionDescription}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Post-registration checklist</CardTitle><CardDescription>Tasks adapt to the entry point and the identity claims available now.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChecklistItem icon={BadgeCheck} title="Legal acceptance captured" detail={`Terms ${pending.legalVersions.terms} · Privacy ${pending.legalVersions.privacy} · ${new Date(pending.acceptedAt).toLocaleString()}`} done />
          <ChecklistItem icon={MailCheck} title={session.emailVerified ? "Email verified" : "Verify your email"} detail={session.emailVerified ? "The current Auth0 session reports email_verified=true." : "Use the Auth0 verification message. Resend, expiry, and deliverability are tenant-configured."} done={session.emailVerified} />
          <ChecklistItem icon={UserRoundCheck} title="Complete your profile" detail="The existing welcome flow asks only for missing name and phone fields, and can be skipped." done={false} />
        </CardContent>
      </Card>

      <Alert>
        <CircleDashed />
        <AlertTitle>{pending.marketingConsent ? "Optional communications selected" : "No marketing opt-in selected"}</AlertTitle>
        <AlertDescription>This choice is separate from required legal acceptance. The POC records the choice but does not claim a CRM or product-platform write.</AlertDescription>
      </Alert>

      <div className="flex flex-wrap justify-center gap-3">
        {session.signedIn ? <Button nativeButton={false} render={<Link href="/profile" />}>Continue to profile<ArrowRight data-icon="inline-end" /></Button> : <Button nativeButton={false} render={<Link href={config.nextHref} />}>{config.nextLabel}<ArrowRight data-icon="inline-end" /></Button>}
        <Button variant="outline" nativeButton={false} render={<Link href="/register" />}>Try another entry point</Button>
      </div>
    </main>
  )
}

function ChecklistItem({ icon: Icon, title, detail, done }: { icon: typeof BadgeCheck; title: string; detail: string; done: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border p-4">
      <span className={done ? "rounded-full bg-primary p-2 text-primary-foreground" : "rounded-full bg-muted p-2 text-muted-foreground"}><Icon className="size-5" aria-hidden="true" /></span>
      <div className="flex flex-col gap-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{title}</h2><Badge variant={done ? "default" : "outline"}>{done ? "Complete" : "Next"}</Badge></div><p className="text-sm leading-relaxed text-muted-foreground">{detail}</p></div>
    </div>
  )
}
