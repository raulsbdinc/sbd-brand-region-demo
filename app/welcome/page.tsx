import Link from "next/link"
import {
  BadgeCheck,
  Braces,
  ExternalLink,
  Info,
  LogOut,
  ShieldCheck,
  UserCog,
} from "lucide-react"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { extractSbdClaims, extractOtherSites } from "@/lib/claims"
import { CrossBrandRecognition } from "@/components/cross-brand-recognition"
import { WelcomeClient } from "@/components/welcome-client"
import { ProgressiveProfileGate } from "@/components/progressive-profile-gate"
import { InspectTokensButton } from "@/components/inspect-tokens-button"
import { SignOutButton } from "@/components/sign-out-button"

// /welcome is the unified post-login landing page.
//
// - Promoted REAL flows (social, password) and the "Try it live" flow redirect
//   here after Auth0 Universal Login, leaving a signed server-side session
//   cookie. When that cookie is present we render the genuine Auth0 claims.
// - The remaining SIMULATED flows (passkey, magic link, email code, SSO, QR)
//   have no server session; they fall back to <WelcomeClient />, which reads the
//   client-side mock session.
export const dynamic = "force-dynamic"

export default async function WelcomePage() {
  let session: { user: Record<string, unknown> } | null = null
  if (isAuthConfigured()) {
    try {
      session = await auth0.getSession()
    } catch {
      session = null
    }
  }

  if (session?.user) {
    return (
      <ProgressiveProfileGate>
        <RealWelcome user={session.user} />
      </ProgressiveProfileGate>
    )
  }

  return <WelcomeClient />
}

function RealWelcome({ user }: { user: Record<string, unknown> }) {
  const name =
    (user.name as string) ?? (user.nickname as string) ?? "Signed-in user"
  const email = user.email as string | undefined
  const picture = user.picture as string | undefined
  const sub = user.sub as string | undefined
  const firstName = name.split(" ")[0]

  // Read the namespaced SBD custom claims injected by the post-login Action.
  // When the Action has not been deployed yet, `present` is false and we show a
  // hint instead of empty values.
  const claims = extractSbdClaims(user)

  // Other demo sites this same account has already signed into (most recent
  // first). Empty on a user's first site — the recognition panel renders
  // nothing in that case.
  const otherSites = extractOtherSites(user)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-col items-center text-center">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture || "/placeholder.svg"}
            alt=""
            className="size-[72px] rounded-full object-cover"
          />
        ) : (
          <span className="flex size-[72px] items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-foreground">
          <BadgeCheck className="size-3.5 text-primary" />
          Real Auth0 session
        </div>
        <h1 className="mt-3 text-balance text-3xl font-extrabold tracking-tight">
          Welcome, {firstName}.
        </h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          You&apos;re signed in with a genuine, signed session from Auth0 / Okta.
        </p>
      </div>

      {/* Cross-brand recognition — the first thing a person sees after signing
          in on a second brand. Renders nothing on a user's first site. */}
      <CrossBrandRecognition sites={otherSites} />

      {/* Account summary */}
      <div className="mt-8 rounded-2xl border border-primary/40 bg-primary/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" />
          Session details
        </h2>
        <dl className="mt-3 grid gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Name" value={name} />
          {email ? <Detail label="Email" value={email} /> : null}
          {sub ? <Detail label="Subject (sub)" value={sub} mono /> : null}
        </dl>
      </div>

      {/* SBD custom claims (from the post-login Action) */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <UserCog className="size-4 text-primary" />
            SBD identity context
          </h2>
          <span
            className={
              claims.present
                ? "rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary ring-1 ring-primary/30"
                : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            }
          >
            {claims.present ? "From Action" : "Not available"}
          </span>
        </div>

        {claims.present ? (
          <dl className="mt-3 grid gap-y-3 text-sm sm:grid-cols-2">
            {claims.roles.length > 0 ? (
              <div>
                <dt className="text-xs text-muted-foreground">Roles</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {claims.roles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-foreground"
                    >
                      {role}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            <Detail
              label="Directory ID (MUID)"
              value={claims.muid ?? "—"}
              mono
            />
            {claims.authMethod ? (
              <Detail label="Auth method" value={claims.authMethod} />
            ) : null}
            {claims.idp ? <Detail label="Identity provider" value={claims.idp} /> : null}
          </dl>
        ) : (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p>
              The additional SBD identity context isn&apos;t available for this
              session. Your sign-in is still valid — this section simply has
              nothing extra to show right now.
            </p>
          </div>
        )}
      </div>

      {/* Raw claims */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Braces className="size-4 text-primary" />
            Decoded ID token claims
          </h2>
          <a
            href="/auth/profile"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-4 hover:underline"
          >
            Raw /auth/profile
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
          {JSON.stringify(user, null, 2)}
        </pre>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <InspectTokensButton />
        <Link href="/account">
          <button
            type="button"
            className="inline-flex h-12 items-center gap-2 rounded-lg border border-border bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View account &amp; tenants
          </button>
        </Link>
        {/* Canonical logout (see lib/logout.ts) via the shared client island. */}
        <SignOutButton className="inline-flex h-12 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <LogOut className="size-5" />
          Sign out &amp; try another method
        </SignOutButton>
      </div>
    </main>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "break-all font-mono text-foreground"
            : "font-medium text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  )
}
