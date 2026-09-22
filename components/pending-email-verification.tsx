"use client"

import { useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { EmailVerificationStatus } from "@/components/email-verification-status"
import { useApp } from "@/components/app-providers"
import { Button } from "@/components/ui/button"

/**
 * Limited session shown until the directory reports the sign-in email as
 * verified. The account exists and can resend the message; it is not the
 * finished profile.
 */
export function PendingEmailVerification({ email }: { email: string | null }) {
  const router = useRouter()
  const { logout } = useApp()
  const refreshed = useRef(false)
  const onVerified = useCallback(() => {
    if (refreshed.current) return
    refreshed.current = true
    router.refresh()
  }, [router])

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="brand-display text-3xl text-foreground">Confirm your email</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        {email
          ? `${email} is signed in, but this account is not active yet.`
          : "This account is not active yet."}{" "}
        Open the verification email, then return here. Resend it if it never arrived or the link has expired.
      </p>
      <EmailVerificationStatus
        live
        email={email}
        initialVerified={false}
        onVerified={onVerified}
      />
      <Button className="mt-6" variant="outline" onClick={() => logout()}>
        Sign out
      </Button>
    </main>
  )
}
