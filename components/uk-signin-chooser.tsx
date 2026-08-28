"use client"

import { useMemo, useState, type ComponentType } from "react"
import Link from "next/link"
import { AtSign, KeyRound, Layers, LogIn, Mails, Info } from "lucide-react"
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
import { GoogleMark } from "@/components/google-mark"
import { startAuthRedirect } from "@/lib/auth0-connections"
import {
  ukSignInOptions,
  UK_SIGNIN_ERROR_COPY,
  type UkSignInOptionId,
  type UkSignInTargetReason,
} from "@/lib/uk-signin"
import type { BrandId } from "@/lib/types"

interface Props {
  brand: BrandId
  brandName: string
  otherBrandName: string
  /** True when a non-production ?market override is showing this UK UI. */
  overridden: boolean
  /** Sanitized in-app path to land on after login. */
  returnTo: string
  /** A reason bounced back from the start route (mapped to friendly copy). */
  initialError: string | null
  initialOption: UkSignInOptionId | null
}

// Icon per option. Google uses the real brand mark; the rest use lucide glyphs
// that echo the registration journeys (Mails / Layers) for visual continuity.
const OPTION_ICON: Record<
  UkSignInOptionId,
  ComponentType<{ className?: string }>
> = {
  shared: LogIn,
  "per-email": Mails,
  brand: Layers,
  google: GoogleMark,
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function friendlyError(reason: string | null): string | null {
  if (!reason) return null
  if (reason in UK_SIGNIN_ERROR_COPY) {
    return UK_SIGNIN_ERROR_COPY[reason as UkSignInTargetReason]
  }
  return "We couldn't start sign-in. Please choose an option and try again."
}

export function UkSignInChooser({
  brand,
  brandName,
  otherBrandName,
  overridden,
  returnTo,
  initialError,
  initialOption,
}: Props) {
  const options = useMemo(() => ukSignInOptions(brandName), [brandName])
  const [selected, setSelected] = useState<UkSignInOptionId | null>(
    initialOption,
  )
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(friendlyError(initialError))

  const current = options.find((o) => o.id === selected) ?? null
  const needsEmail = current?.needsEmail ?? false
  const emailValid = looksLikeEmail(email.trim())
  const canContinue = Boolean(current) && (!needsEmail || emailValid)

  function choose(id: UkSignInOptionId) {
    setSelected(id)
    setError(null)
  }

  function handleContinue() {
    if (!current) {
      setError("Please choose how your account was set up.")
      return
    }
    if (current.needsEmail && !emailValid) {
      setError("Enter the email address for this account first.")
      return
    }

    const params = new URLSearchParams({ option: current.id, returnTo })
    if (current.needsEmail) params.set("email", email.trim())
    // Carry the preview override so a non-production ?market=uk walkthrough
    // reaches the (re-gated) start route intact.
    if (overridden) params.set("market", "uk")

    // The start route 307-redirects to Auth0's hosted /auth/login, which
    // refuses to be framed. startAuthRedirect breaks out of the v0 preview
    // iframe (new tab) when embedded, and does an ordinary navigation
    // otherwise. Must run from this click gesture so the tab isn't blocked.
    startAuthRedirect(`/api/signin/uk?${params.toString()}`)
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-6 text-primary" aria-hidden="true" />
        </span>
        <h1 className="text-balance text-3xl font-bold tracking-tight">
          Sign in to {brandName}
        </h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          Accounts can be set up in a few different ways across our brands. Tell
          us how you set yours up and we&apos;ll take you straight to the right
          sign-in.
        </p>
      </header>

      {overridden ? (
        <Alert>
          <Info />
          <AlertTitle>Preview only</AlertTitle>
          <AlertDescription>
            You&apos;re viewing the UK sign-in chooser via a preview override.
            This deployment&apos;s real market isn&apos;t UK, so completing
            sign-in will report that the option isn&apos;t available here.
          </AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-semibold">
          How did you set up your account?
        </legend>
        <div
          role="radiogroup"
          aria-label="How your account was set up"
          className="flex flex-col gap-3"
        >
          {options.map((opt) => {
            const Icon = OPTION_ICON[opt.id]
            const isSelected = selected === opt.id
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer gap-4 rounded-xl border p-4 transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40 hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="uk-signin-option"
                  value={opt.id}
                  checked={isSelected}
                  onChange={() => choose(opt.id)}
                  className="sr-only"
                />
                <span
                  className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-semibold">{opt.label}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {needsEmail ? (
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s your email?</CardTitle>
            <CardDescription>
              We&apos;ll take you to the sign-in screen with this address filled
              in. Your password is only ever entered on the secure sign-in page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="uk-signin-email">Email</Label>
            <div className="relative">
              <AtSign
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="uk-signin-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                className="pl-9"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) setError(null)
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault()
                    if (canContinue) handleContinue()
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        <Button
          className="self-start"
          disabled={!canContinue}
          onClick={handleContinue}
        >
          {selected === "google" ? (
            <>
              <GoogleMark className="size-4" />
              Continue with Google
            </>
          ) : (
            <>
              <KeyRound data-icon="inline-start" />
              Continue to sign in
            </>
          )}
        </Button>

        <p className="text-sm text-muted-foreground">
          New to {brandName}?{" "}
          <Link
            href={overridden ? "/register/uk?market=uk" : "/register/uk"}
            className="font-medium text-primary underline underline-offset-4"
          >
            Create an account
          </Link>
          {otherBrandName ? (
            <span className="sr-only"> — accounts can also cover {otherBrandName}.</span>
          ) : null}
        </p>
      </div>
    </main>
  )
}
