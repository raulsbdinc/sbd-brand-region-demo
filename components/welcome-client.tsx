"use client"

import { useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Braces, Clock, MousePointerClick, RotateCcw, ShieldCheck } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { getMethod } from "@/lib/methods"
import { Button } from "@/components/ui/button"

// MOCK WELCOME
// ============
// Rendered by /welcome only when there is no real Auth0 session. It reads the
// client-side mock session produced by the simulated flows (passkey, magic
// link, email code, SSO, QR) and shows the metrics + token inspector demo.
export function WelcomeClient() {
  const { session, setTokenInspectorOpen, logout, openSignIn } = useApp()
  const router = useRouter()

  useEffect(() => {
    // No mock session: land on the branded storefront with the sign-in drawer
    // open, rather than the old /signin showcase. The drawer flag lives in
    // context, so it survives this client navigation and opens once home mounts.
    if (!session) {
      openSignIn()
      router.replace("/")
    }
  }, [session, router, openSignIn])

  if (!session) return null

  const method = getMethod(session.method)
  const seconds = (session.metrics.timeMs / 1000).toFixed(1)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-col items-center text-center">
        {session.avatarUrl ? (
          <Image
            src={session.avatarUrl}
            alt=""
            width={72}
            height={72}
            className="size-[72px] rounded-full object-cover"
          />
        ) : (
          <span className="flex size-[72px] items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {session.name.charAt(0).toUpperCase()}
          </span>
        )}
        <h1 className="mt-4 text-balance text-3xl font-extrabold tracking-tight">
          Welcome, {session.name.split(" ")[0]}.
        </h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          You&apos;re signed in with <strong>{method.name}</strong>
          {session.provider ? ` via ${session.provider}` : ""}.
        </p>
      </div>

      {/* Metrics */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Metric
          icon={<Clock className="size-4 text-primary" />}
          label="Time to sign in"
          value={`${seconds}s`}
        />
        <Metric
          icon={<MousePointerClick className="size-4 text-primary" />}
          label="Interactions"
          value={`${session.metrics.taps}`}
        />
        <Metric
          icon={<ShieldCheck className="size-4 text-primary" />}
          label="Method"
          value={method.tag}
        />
      </div>

      {/* Account summary */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Session details
        </h2>
        <dl className="mt-3 grid gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Email" value={session.email} />
          <Detail label="Directory ID (MUID)" value={session.muid} mono />
          <Detail label="Roles" value={session.roles.join(", ")} />
          <Detail
            label="Signed in at"
            value={new Date(session.signedInAt).toLocaleTimeString()}
          />
        </dl>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          variant="secondary"
          className="h-12"
          onClick={() => setTokenInspectorOpen(true)}
        >
          <Braces className="size-5" />
          Inspect tokens
        </Button>
        <Link href="/account">
          <Button size="lg" variant="outline" className="h-12">
            View account &amp; tenants
          </Button>
        </Link>
        <Button size="lg" variant="ghost" className="h-12" onClick={() => logout()}>
          <RotateCcw className="size-5" />
          Sign out &amp; try another method
        </Button>
      </div>
    </main>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-foreground">{value}</p>
    </div>
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
      <dd className={mono ? "font-mono text-foreground" : "font-medium text-foreground"}>
        {value}
      </dd>
    </div>
  )
}
