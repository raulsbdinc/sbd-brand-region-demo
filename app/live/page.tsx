import {
  ShieldCheck,
  BadgeCheck,
  ExternalLink,
  AlertTriangle,
  LogOut,
} from "lucide-react"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { SignOutButton } from "@/components/sign-out-button"

// This page performs an actual redirect to Auth0 Universal Login against the SBD
// demo tenant and reads back a real, signed session. The promoted mock flows
// (social, password) now redirect through the same /auth/* routes.
export const dynamic = "force-dynamic"

export default async function LivePage() {
  const configured = isAuthConfigured()

  // getSession reads the encrypted session cookie. It returns null when signed
  // out, and we guard against throwing if the client is not configured yet.
  let session = null
  if (configured) {
    try {
      session = await auth0.getSession()
    } catch {
      session = null
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          Auth0 connection check
        </div>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground">
          Try the Auth0 login
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
            This page checks the current deployment. When Auth0 is configured, it
            redirects to Universal Login and reads the signed session returned to
            this app. Other sign-in paths may use the same connection or show a
            labeled demo.
        </p>
      </header>

      {!configured ? (
        <ConfigNeeded />
      ) : session ? (
        <SignedIn session={session} />
      ) : (
        <SignedOut />
      )}
    </main>
  )
}

function ConfigNeeded() {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div>
          <h2 className="font-semibold text-foreground">Not configured yet</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {
              "The Auth0 environment variables are missing, so the live flow can't run. Add AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, and AUTH0_SECRET to the project, then redeploy."
            }
          </p>
        </div>
      </div>
    </div>
  )
}

function SignedOut() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h2 className="text-lg font-bold text-foreground">{"You're signed out"}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Click below to start a real login. You will leave this app, authenticate on
        Auth0&apos;s hosted page, and return here with a signed session.
      </p>

      {/* Must be a plain anchor, not next/link, so the navigation hits the
          server-mounted /auth/login route instead of client routing. */}
      <a
        href="/auth/login"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ShieldCheck className="size-5" />
        Sign in with Auth0
      </a>

      <ol className="mt-6 space-y-2 text-sm text-muted-foreground">
        <li>1. Redirect to Universal Login on the SBD demo tenant.</li>
        <li>2. Authenticate (or sign up) with a real connection.</li>
        <li>3. Return to this page with a signed session and decoded claims.</li>
      </ol>
    </div>
  )
}

function SignedIn({ session }: { session: { user: Record<string, unknown> } }) {
  const user = session.user
  const name = (user.name as string) ?? (user.nickname as string) ?? "Signed-in user"
  const email = user.email as string | undefined
  const picture = user.picture as string | undefined
  const sub = user.sub as string | undefined

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BadgeCheck className="size-5 text-primary" />
          Real Auth0 session active
        </div>

        <div className="mt-5 flex items-center gap-4">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture || "/placeholder.svg"}
              alt=""
              className="size-14 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-bold text-foreground">{name}</p>
            {email ? (
              <p className="truncate text-sm text-muted-foreground">{email}</p>
            ) : null}
            {sub ? (
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {sub}
              </p>
            ) : null}
          </div>
        </div>

        <SignOutButton className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <LogOut className="size-4" />
          Sign out
        </SignOutButton>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-foreground">Decoded ID token claims</h2>
          <a
            href="/auth/profile"
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground underline-offset-4 hover:underline"
          >
            Raw /auth/profile
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          These are real claims returned by Auth0 for the signed-in user.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
          {JSON.stringify(user, null, 2)}
        </pre>
      </div>
    </div>
  )
}
