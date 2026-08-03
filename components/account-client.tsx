"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  Check,
  Fingerprint,
  Code2,
  Hash,
  KeyRound,
  Link2,
  Mail,
  Plus,
  User,
} from "lucide-react"
import { useApp } from "@/components/app-providers"
import { getMethod } from "@/lib/methods"
import type { MethodId } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// MOCK ACCOUNT CENTER
// ===================
// Rendered by /account only when there is NO real Auth0 session. It reads the
// client-side mock session produced by the simulated flows (passkey, magic
// link, email code, SSO, QR) and shows the tenant switcher + linked methods
// demo. The real-session account center lives in components/real-account.tsx.

interface Tenant {
  id: string
  name: string
  kind: "Personal" | "Organization"
  role: string
}

interface LinkedMethod {
  id: MethodId
  label: string
  detail: string
}

const METHOD_ICON: Record<MethodId, typeof Fingerprint> = {
  passkey: Fingerprint,
  "magic-link": Mail,
  "email-code": Hash,
  password: KeyRound,
  social: Code2,
  sso: Building2,
  qr: KeyRound,
}

const LINKABLE: { id: MethodId; label: string; detail: string }[] = [
  { id: "passkey", label: "Passkey", detail: "This device" },
  { id: "social", label: "Social provider", detail: "Google, Apple, Microsoft & more" },
  { id: "sso", label: "Work account (SSO)", detail: "@sbdinc.com" },
]

export function AccountClient() {
  const { session } = useApp()
  const router = useRouter()

  useEffect(() => {
    if (!session) router.replace("/signin")
  }, [session, router])

  const initialTenants = useMemo<Tenant[]>(() => {
    const base: Tenant[] = [
      { id: "personal", name: "Personal", kind: "Personal", role: "customer" },
    ]
    if (session?.roles.includes("pro-member")) {
      base.push({
        id: "pro",
        name: "Pro Desk Membership",
        kind: "Organization",
        role: "pro-member",
      })
    }
    if (session?.roles.includes("employee")) {
      base.push({
        id: "sbd",
        name: "Stanley Black & Decker, Inc.",
        kind: "Organization",
        role: "employee",
      })
    }
    return base
  }, [session])

  const [activeTenant, setActiveTenant] = useState("personal")
  const [linked, setLinked] = useState<LinkedMethod[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])

  // Seed local state once a session is available.
  useEffect(() => {
    if (!session) return
    const method = getMethod(session.method)
    setLinked([
      {
        id: session.method,
        label: method.name,
        detail: session.provider ? `via ${session.provider}` : session.email,
      },
    ])
    setTenants(initialTenants)
    setActiveTenant(initialTenants[0]?.id ?? "personal")
  }, [session, initialTenants])

  if (!session) return null

  const availableToLink = LINKABLE.filter(
    (l) => !linked.some((m) => m.id === l.id),
  )

  function linkMethod(l: { id: MethodId; label: string; detail: string }) {
    setLinked((prev) => [...prev, l])
  }

  function addOrg() {
    const id = `org-${tenants.length}`
    setTenants((prev) => [
      ...prev,
      {
        id,
        name: "Acme Contracting LLC",
        kind: "Organization",
        role: "buyer",
      },
    ])
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
          {session.name.charAt(0).toUpperCase()}
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{session.name}</h1>
          <p className="text-sm text-muted-foreground">{session.email}</p>
        </div>
      </header>

      {/* Tenant switcher */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your tenants
          </h2>
          <Button size="sm" variant="ghost" onClick={addOrg}>
            <Plus className="size-4" />
            Join organization
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          One identity ({" "}
          <span className="font-mono text-foreground">{session.muid}</span> ) can
          belong to multiple tenants, each with its own role. Switch the active
          context below.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tenants.map((t) => {
            const active = t.id === activeTenant
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTenant(t.id)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {t.kind === "Organization" ? (
                    <Building2 className="size-5" />
                  ) : (
                    <User className="size-5" />
                  )}
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.kind} &middot; role: {t.role}
                  </span>
                </span>
                {active && <Check className="size-5 text-primary" />}
              </button>
            )
          })}
        </div>
      </section>

      {/* Linked sign-in methods */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Linked sign-in methods
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add more ways to sign in to the same account. Any linked method returns
          you to this identity.
        </p>

        <ul className="mt-4 space-y-2">
          {linked.map((m) => {
            const Icon = METHOD_ICON[m.id]
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Icon className="size-5" />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-foreground">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">{m.detail}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-foreground">
                  <Check className="size-3.5" />
                  Linked
                </span>
              </li>
            )
          })}
        </ul>

        {availableToLink.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-border p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Link2 className="size-4 text-primary" />
              Link another method
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {availableToLink.map((l) => {
                const Icon = METHOD_ICON[l.id]
                return (
                  <Button
                    key={l.id}
                    size="sm"
                    variant="outline"
                    onClick={() => linkMethod(l)}
                  >
                    <Icon className="size-4" />
                    {l.label}
                  </Button>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
