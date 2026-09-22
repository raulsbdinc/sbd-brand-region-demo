"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { BadgeCheck, Loader2, MailWarning, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface VerificationData {
  configured: boolean
  verified?: boolean
  destination?: string | null
  hasEmail?: boolean
}

const fetcher = async (url: string): Promise<VerificationData> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error("Verification status unavailable")
  return response.json()
}

export function EmailVerificationStatus({
  live,
  email,
  initialVerified,
  onVerified,
}: {
  live: boolean
  email: string | null
  initialVerified: boolean
  /** Called once the directory reports the address as verified. */
  onVerified?: () => void
}) {
  const { data, mutate, isLoading } = useSWR<VerificationData>(
    live ? "/api/account/verification" : null,
    fetcher,
  )
  const [demoVerified, setDemoVerified] = useState(initialVerified)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(false), 60_000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  useEffect(() => {
    if (data?.verified) onVerified?.()
  }, [data?.verified, onVerified])

  const configured = live && data?.configured !== false
  const verified = configured ? Boolean(data?.verified) : demoVerified
  const destination = configured ? data?.destination : email

  async function resend() {
    setError(null)
    setNote(null)
    if (!configured) {
      setNote("Verification email requested. (Simulated in Demo mode.)")
      return
    }
    setBusy(true)
    try {
      const response = await fetch("/api/account/verification", { method: "POST" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? "Could not send the verification email.")
      } else if (body.verified) {
        setDemoVerified(true)
        setNote("This email is already verified.")
      } else {
        setCooldown(true)
        setNote(
          `Verification email sent${body.destination ? ` to ${body.destination}` : ""}. You can request another in 60 seconds.`,
        )
      }
      await mutate()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!email) return null

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-primary">
            {verified ? (
              <BadgeCheck className="size-5" aria-hidden="true" />
            ) : (
              <MailWarning className="size-5" aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {verified ? "Email verified" : "Email verification pending"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isLoading
                ? "Checking your directory record…"
                : verified
                  ? "Your sign-in email has been confirmed."
                  : `Confirm ${destination || "your email"} before this account is active. The link expires; resend it if it never arrived or has expired.`}
            </p>
          </div>
        </div>
        {!verified ? (
          <Button
            variant="outline"
            size="sm"
            onClick={resend}
            disabled={busy || isLoading || cooldown}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            Resend email
          </Button>
        ) : null}
      </div>
      {note ? <p className="mt-3 text-xs font-medium text-foreground" role="status">{note}</p> : null}
      {error ? <p className="mt-3 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}
