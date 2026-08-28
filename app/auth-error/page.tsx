import Link from "next/link"
import type { Metadata } from "next"
import { Ban, LifeBuoy, RefreshCw, ShieldAlert } from "lucide-react"
import { ERASURE_GRACE_PERIOD_DAYS } from "@/lib/erasure"
import type { AuthErrorReason } from "@/lib/auth-callback"

export const metadata: Metadata = {
  title: "Sign-in problem",
  description: "We couldn't complete your sign-in.",
}

// Friendly landing page for a failed Auth0 callback. The `reason` is a safe,
// fixed code set by lib/auth-callback.ts — never raw Auth0 error text.
export const dynamic = "force-dynamic"

type Copy = {
  icon: typeof ShieldAlert
  title: string
  body: React.ReactNode
  primary: { href: string; label: string }
}

function copyFor(reason: AuthErrorReason): Copy {
  switch (reason) {
    case "blocked":
      return {
        icon: Ban,
        title: "This account has been deactivated",
        body: (
          <>
            This account was deactivated, so it can no longer sign in. If you
            requested deletion, it stays recoverable for{" "}
            <strong className="font-semibold text-foreground">
              {ERASURE_GRACE_PERIOD_DAYS} days
            </strong>
            . During that window an administrator can restore it — after that the
            erasure is finalized.
          </>
        ),
        primary: { href: "/pathways", label: "Try a different account" },
      }
    case "access_denied":
      return {
        icon: ShieldAlert,
        title: "Sign-in was not authorized",
        body: (
          <>
            The identity provider declined this sign-in. This can happen if a
            required step (such as multi-factor verification or a consent prompt)
            was cancelled. You can try again from the start.
          </>
        ),
        primary: { href: "/auth/login", label: "Try signing in again" },
      }
    case "state":
      return {
        icon: RefreshCw,
        title: "Your sign-in session expired",
        body: (
          <>
            The sign-in took too long or was opened in more than one tab, so the
            secure session state no longer matches. Start a fresh sign-in and it
            should work.
          </>
        ),
        primary: { href: "/auth/login", label: "Start a fresh sign-in" },
      }
    case "config":
      return {
        icon: ShieldAlert,
        title: "Sign-in is temporarily unavailable",
        body: (
          <>
            We couldn&apos;t reach the identity service to complete your sign-in.
            This is usually temporary — please try again in a moment.
          </>
        ),
        primary: { href: "/auth/login", label: "Try again" },
      }
    case "link_unavailable":
      return {
        icon: RefreshCw,
        title: "We couldn't finish connecting Google",
        body: (
          <>
            You already have an account with this email, and we couldn&apos;t
            verify it just now to connect Google safely — so we stopped rather
            than create a second account. Please try signing in again in a
            moment.
          </>
        ),
        primary: { href: "/auth/login", label: "Try signing in again" },
      }
    case "link_ambiguous":
      return {
        icon: ShieldAlert,
        title: "We need a hand connecting Google",
        body: (
          <>
            More than one account is associated with this email, so we
            couldn&apos;t safely decide which one to connect Google to. To avoid
            creating a duplicate, please contact support and we&apos;ll link it
            for you.
          </>
        ),
        primary: { href: "/auth/login", label: "Back to sign-in" },
      }
    default:
      return {
        icon: ShieldAlert,
        title: "We couldn't complete your sign-in",
        body: (
          <>
            Something went wrong while finishing your sign-in. Please try again;
            if it keeps happening, contact support.
          </>
        ),
        primary: { href: "/auth/login", label: "Try again" },
      }
  }
}

const VALID_REASONS: AuthErrorReason[] = [
  "blocked",
  "access_denied",
  "state",
  "config",
  "error",
  "link_ambiguous",
  "link_unavailable",
]

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason: raw } = await searchParams
  const reason: AuthErrorReason = VALID_REASONS.includes(raw as AuthErrorReason)
    ? (raw as AuthErrorReason)
    : "error"
  const { icon: Icon, title, body, primary } = copyFor(reason)

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-16 text-center sm:px-6">
      <span className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="size-8 text-destructive" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-balance text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
        {body}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href={primary.href}>
          <button
            type="button"
            className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {primary.label}
          </button>
        </Link>
        <Link href="/">
          <button
            type="button"
            className="inline-flex h-12 items-center gap-2 rounded-lg border border-border bg-background px-6 text-sm font-semibold text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to home
          </button>
        </Link>
      </div>

      {reason === "blocked" ? (
        <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-4 text-left text-sm leading-relaxed text-muted-foreground">
          <LifeBuoy className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>
            Deactivated this account by mistake? An administrator can restore it
            during the grace window from the{" "}
            <Link
              href="/admin/restore"
              className="font-medium text-foreground underline underline-offset-4"
            >
              account restore tool
            </Link>
            .
          </p>
        </div>
      ) : null}
    </main>
  )
}
