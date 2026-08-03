"use client"

import { type ReactNode, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Fingerprint,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { useApp, useBrand } from "@/components/app-providers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SOCIAL_CONNECTIONS,
  buildAuthLoginUrl,
  getLiveSocialProviders,
  startAuthRedirect,
} from "@/lib/auth0-connections"
import { looksLikeEmail } from "@/lib/auth-service"
import type { SocialProvider } from "@/lib/types"
import { cn } from "@/lib/utils"

const RETURN_TO = "/welcome"

// Providers shown on the card, with a brand glyph. Order matters: live ones
// (verified on the tenant) float to the top so the working option is first.
interface ProviderMeta {
  id: SocialProvider
  hue: string
  glyph: ReactNode
}
const PROVIDERS: ProviderMeta[] = [
  { id: "Google", hue: "#ea4335", glyph: "G" },
  { id: "Apple", hue: "#111111", glyph: "A" },
  { id: "Microsoft", hue: "#0078d4", glyph: "M" },
  { id: "Facebook", hue: "#1877f2", glyph: "f" },
]

export function SignInExperience() {
  const { authConfigured, startFlow } = useApp()
  const brand = useBrand()
  const live = authConfigured

  const [email, setEmail] = useState("")
  const [touched, setTouched] = useState(false)
  const [redirecting, setRedirecting] = useState<string | null>(null)

  const liveProviders = useMemo(() => getLiveSocialProviders(), [])
  const orderedProviders = useMemo(() => {
    const isLive = (id: SocialProvider) => liveProviders.includes(id)
    return [...PROVIDERS].sort((a, b) => Number(isLive(b.id)) - Number(isLive(a.id)))
  }, [liveProviders])

  const emailValid = looksLikeEmail(email)

  function goLive(opts: Parameters<typeof buildAuthLoginUrl>[0], label: string) {
    setRedirecting(label)
    startAuthRedirect(buildAuthLoginUrl(opts))
  }

  function continueWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!emailValid) return
    if (live) {
      goLive({ returnTo: RETURN_TO, loginHint: email }, "email")
    } else {
      // Demo: the cinematic email-code simulation accepts an email and lands
      // on the same welcome screen.
      startFlow("email-code")
    }
  }

  function createAccount() {
    if (live) {
      goLive(
        {
          returnTo: RETURN_TO,
          loginHint: emailValid ? email : undefined,
          screenHint: "signup",
        },
        "signup",
      )
    } else {
      startFlow("email-code")
    }
  }

  function pickProvider(id: SocialProvider) {
    if (live) {
      if (!liveProviders.includes(id)) return
      goLive({ connection: SOCIAL_CONNECTIONS[id], returnTo: RETURN_TO }, id)
    } else {
      startFlow("social")
    }
  }

  function usePasskey() {
    if (live) {
      goLive({ returnTo: RETURN_TO }, "passkey")
    } else {
      startFlow("passkey")
    }
  }

  if (redirecting) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <Loader2 className="mb-6 size-10 animate-spin text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Taking you to sign in…</h1>
        <p className="mt-2 max-w-sm leading-relaxed text-muted-foreground">
          You&apos;ll authenticate securely on our identity provider and come
          right back to {brand.name}.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm lg:grid lg:grid-cols-2">
        {/* Brand value panel (hidden on small screens) */}
        <aside className="relative hidden flex-col justify-between bg-[var(--brand-ink)] p-10 text-[var(--brand-ink-foreground)] lg:flex">
          <div>
            <span className="inline-flex items-center rounded-sm bg-[var(--brand)] px-2.5 py-1 text-sm font-extrabold tracking-tight text-[var(--brand-foreground)]">
              {brand.wordmark}
            </span>
            <h2 className="mt-8 text-balance text-3xl font-extrabold leading-tight tracking-tight">
              Your tools, your account, one secure sign-in.
            </h2>
            <p className="mt-4 max-w-sm text-pretty leading-relaxed text-[var(--brand-ink-foreground)]/70">
              Track orders, register tools, and unlock pro pricing. Sign in with
              email, a passkey, or your favorite provider — your choice.
            </p>
          </div>
          <ul className="mt-10 space-y-3 text-sm text-[var(--brand-ink-foreground)]/80">
            {[
              "One account across every SBD brand and region",
              "Passwordless options — passkeys and one-time codes",
              "Bank-grade security, brokered through Auth0 / Okta",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--brand)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </aside>

        {/* Sign-in form */}
        <div className="p-6 sm:p-10">
          {/* Brand wordmark on mobile only (panel is hidden) */}
          <span className="mb-6 inline-flex items-center rounded-sm bg-[var(--brand-ink)] px-2.5 py-1 text-sm font-extrabold tracking-tight text-[var(--brand-ink-foreground)] lg:hidden">
            {brand.wordmark}
          </span>

          <h1 className="text-balance text-2xl font-bold tracking-tight text-foreground">
            Sign in or create your account
          </h1>
          <p className="mt-1.5 text-pretty text-sm leading-relaxed text-muted-foreground">
            Enter your email to continue. New to {brand.name}? We&apos;ll help
            you set one up.
          </p>

          <form onSubmit={continueWithEmail} className="mt-6 space-y-2">
            <Label htmlFor="signin-email">Email address</Label>
            <Input
              id="signin-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !emailValid}
              className="h-12 text-base"
            />
            {touched && !emailValid ? (
              <p className="text-xs text-destructive">
                Enter a valid email address to continue.
              </p>
            ) : null}
            <Button type="submit" className="mt-2 h-12 w-full text-base font-semibold">
              Continue
              <ArrowRight className="size-5" />
            </Button>
            <div className="flex justify-end pt-1">
              <Link
                href="/recover"
                className="text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot your password or account?
              </Link>
            </div>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Social providers */}
          <div className="space-y-2.5">
            {orderedProviders.map((p) => {
              const providerLive = !live || liveProviders.includes(p.id)
              const disabled = live && !liveProviders.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProvider(p.id)}
                  disabled={disabled}
                  title={
                    disabled
                      ? `${p.id} is not configured on this tenant yet`
                      : `Continue with ${p.id}`
                  }
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    disabled
                      ? "cursor-not-allowed opacity-55"
                      : "transition-colors hover:bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className="flex size-8 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: p.hue }}
                  >
                    {p.glyph}
                  </span>
                  <span className="flex-1 text-sm font-medium text-foreground">
                    Continue with {p.id}
                  </span>
                  {live && liveProviders.includes(p.id) ? (
                    <ShieldCheck className="size-4 text-primary" />
                  ) : disabled ? (
                    <Lock className="size-3.5 text-muted-foreground" />
                  ) : null}
                </button>
              )
            })}

            {/* Passkey */}
            <button
              type="button"
              onClick={usePasskey}
              title="Sign in with a passkey"
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-foreground">
                <Fingerprint className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium text-foreground">
                Use a passkey
              </span>
            </button>
          </div>

          {/* Footers */}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to {brand.name}?{" "}
            <button
              type="button"
              onClick={createAccount}
              className="font-semibold text-foreground underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Create an account
            </button>
          </p>

          <div className="mt-6 flex flex-col items-center gap-2 border-t border-border pt-5 text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              {live
                ? "Secured by Auth0 / Okta — your password is never seen by SBD."
                : "Demo mode — Auth0 isn't configured, so these run the simulated flows."}
            </p>
            <Link
              href="/pathways"
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Sparkles className="size-3.5" />
              Explore all sign-in options
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
