"use client"

// SBD PASSPORT — cross-region account management (client)
// =======================================================
// One place where a signed-in person sees every regional-tenant account that
// belongs to them and jumps into any one to self-manage it. The value is that
// it is compatible with data residency: the passport holds only the LINK MAP
// (which regional user_ids are the same person); each account's real
// profile/consent/security data stays in its own region and is edited there via
// the existing /account surface.
//
// LIVE vs DEMO (mirrors components/real-account.tsx): when the Management API is
// configured and there is a real session, the passport is read/written through
// /api/account/passport (stored in the home tenant's app_metadata). Otherwise a
// clearly-labeled Demo passport is synthesized and edited in local state only.

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import {
  BadgeCheck,
  Check,
  ExternalLink,
  Globe2,
  Loader2,
  Lock,
  MapPin,
  Plane,
  Plus,
  ShieldCheck,
  Unlink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useApp } from "@/components/app-providers"
import { useToast } from "@/components/ui/toast"
import { regionForCountry } from "@/lib/brands"
import {
  AUTH_REGION_ORDER,
  DEFAULT_AUTH_REGION,
  HOSTING_REGIONS,
  isValidAuthRegion,
  marketsForTenant,
  tenantById,
} from "@/lib/regions"
import {
  newPassportLink,
  synthesizePassport,
  type Passport,
  type PassportLink,
} from "@/lib/passport"

interface PassportResponse {
  configured?: boolean
  live?: boolean
  homeEmail?: string | null
  passport?: Passport
}

interface MeResponse {
  user: { name: string; email: string | null; picture: string | null } | null
  claims: Record<string, unknown> | null
}

const jsonFetcher = (url: string) => fetch(url).then((r) => r.json())

/** Static descriptor for a region, built from the region model. */
function describeRegion(regionId: string) {
  const tenant = tenantById(regionId)
  const hosting = tenant ? HOSTING_REGIONS[tenant.hosting] : undefined
  return {
    id: regionId,
    name: tenant?.name ?? regionId,
    hostingName: hosting?.name ?? "",
    hostingCode: hosting?.code ?? "",
    markets: marketsForTenant(regionId).length,
    special: Boolean(tenant?.special),
  }
}

export function PassportView({ user }: { user: Record<string, unknown> | null }) {
  const { session: mockSession, country, authConfigured } = useApp()
  const router = useRouter()
  const { toast } = useToast()

  // --- Identity resolution (real session preferred, mock as fallback) -------
  // If the Server Component missed the session, re-probe /api/me (same safety
  // net as AccountResolver) so a real user isn't shown a mock identity.
  const { data: probe } = useSWR<MeResponse>(
    !user && authConfigured ? "/api/me" : null,
    jsonFetcher,
  )
  const claims = user ?? probe?.claims ?? null
  const isReal = Boolean(claims)
  const realEmail = (claims?.email as string | undefined) ?? null
  const realName =
    (claims?.name as string | undefined) ??
    (claims?.nickname as string | undefined) ??
    null

  const displayName = realName ?? mockSession?.name ?? "Signed-in user"
  const email = realEmail ?? mockSession?.email ?? "you@sbd.example"

  // --- Passport data (live via API, else synthesized Demo) ------------------
  const { data, isLoading, mutate } = useSWR<PassportResponse>(
    "/api/account/passport",
    jsonFetcher,
    { revalidateOnFocus: false },
  )
  const live = Boolean(data?.live)

  // Demo passport lives in local state so link/unlink work without persistence.
  const demoHome = regionForCountry(country)
  const [demo, setDemo] = useState<Passport | null>(null)
  const [busyRegion, setBusyRegion] = useState<string | null>(null)

  useEffect(() => {
    if (live || isLoading) return
    setDemo(synthesizePassport({ homeRegion: demoHome, email }))
    // Re-seed when the simulated tenant region or identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, isLoading, demoHome, email])

  const passport: Passport | null = live ? data?.passport ?? null : demo
  const homeEmail = live ? data?.homeEmail ?? email : email

  // --- Which regions are linked vs available --------------------------------
  const homeRegion = passport?.homeRegion ?? DEFAULT_AUTH_REGION
  const linkedRegions = useMemo(
    () => new Set((passport?.links ?? []).map((l) => l.region)),
    [passport],
  )
  const availableRegions = useMemo(
    () =>
      AUTH_REGION_ORDER.filter(
        (r) => r !== homeRegion && !linkedRegions.has(r),
      ),
    [homeRegion, linkedRegions],
  )

  // --- Actions --------------------------------------------------------------
  async function linkRegion(region: string) {
    setBusyRegion(region)
    try {
      if (live) {
        const res = await fetch("/api/account/passport", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ region }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? "Link failed")
        await mutate()
      } else {
        setDemo((prev) =>
          prev
            ? {
                ...prev,
                links: [...prev.links, newPassportLink(region, homeEmail)],
                updatedAt: new Date().toISOString(),
              }
            : prev,
        )
      }
      const d = describeRegion(region)
      toast({
        variant: "success",
        title: `Linked ${d.name}`,
        description: `Your ${d.name} account is now in your passport. Its data stays in ${d.hostingName || "its region"}.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not link account",
        description: err instanceof Error ? err.message : "Please try again.",
      })
    } finally {
      setBusyRegion(null)
    }
  }

  async function unlinkRegion(region: string) {
    setBusyRegion(region)
    try {
      if (live) {
        const res = await fetch("/api/account/passport", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ region }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? "Unlink failed")
        await mutate()
      } else {
        setDemo((prev) =>
          prev
            ? {
                ...prev,
                links: prev.links.filter((l) => l.region !== region),
                updatedAt: new Date().toISOString(),
              }
            : prev,
        )
      }
      toast({
        variant: "info",
        title: `Unlinked ${describeRegion(region).name}`,
        description: "The connection was removed. The account itself is untouched.",
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not unlink account",
        description: err instanceof Error ? err.message : "Please try again.",
      })
    } finally {
      setBusyRegion(null)
    }
  }

  // "Manage" routes /account to the chosen region's tenant (sets the region
  // cookie the proxy reads, then opens the account center). In production this
  // is where the user re-authenticates against that tenant.
  async function manageRegion(region: string) {
    try {
      await fetch("/api/region", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ region }),
      })
    } catch {
      // Non-fatal: still navigate; the home region remains active.
    }
    router.push("/account")
  }

  const home = describeRegion(homeRegion)

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      {/* Header */}
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Plane className="size-8" />
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              SBD Passport
            </h1>
            {live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-foreground">
                <BadgeCheck className="size-3.5 text-primary" />
                Link record saved in Auth0
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                Demo
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            A proof of concept for linking regional account records for{" "}
            <span className="font-medium text-foreground">{displayName}</span>.
            Cross-region sign-in and session handoff are not built yet.
          </p>
        </div>
      </header>

      {/* Residency explainer */}
      <div className="mt-6 flex gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          The Passport record is designed to store account identifiers and an
          email address, not a full regional profile. The current Manage action
          changes the selected region and opens this app&apos;s account page; it does
          not sign you into a separate regional tenant.{" "}
          {live
            ? "Link changes save to the current Auth0 directory record."
            : "This is demo-only and resets with the browser state."}
        </p>
      </div>

      {isLoading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your passport…
        </div>
      ) : (
        <>
          {/* Home account */}
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Home region
            </h2>
            <div className="mt-3 rounded-2xl border-2 border-primary/40 bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Globe2 className="size-5" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground">{home.name}</h3>
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        Anchor
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{homeEmail}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" />
                      Data residency: {home.hostingName || "—"}
                      {home.hostingCode ? ` (${home.hostingCode})` : ""}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => manageRegion(homeRegion)}>
                  Manage
                  <ExternalLink className="size-4" />
                </Button>
              </div>
            </div>
          </section>

          {/* Linked accounts */}
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Linked accounts{" "}
              <span className="text-muted-foreground/70">
                ({passport?.links.length ?? 0})
              </span>
            </h2>
            {passport && passport.links.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {passport.links.map((link) => (
                  <LinkedCard
                    key={link.region}
                    link={link}
                    busy={busyRegion === link.region}
                    onManage={() => manageRegion(link.region)}
                    onUnlink={() => unlinkRegion(link.region)}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-border bg-card px-5 py-6 text-center text-sm text-muted-foreground">
                No other regional accounts linked yet. Link one below to manage it
                from your passport.
              </p>
            )}
          </section>

          {/* Available to link */}
          {availableRegions.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Available to link
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a regional link record. This POC does not ask you to sign in
                to that region, so it does not prove that the other account is yours.
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {availableRegions.map((region) => {
                  const d = describeRegion(region)
                  return (
                    <li
                      key={region}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-foreground">
                            {d.name}
                          </span>
                          {d.special ? (
                            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {d.hostingName || "—"}
                          {d.markets
                            ? ` · ${d.markets} ${d.markets === 1 ? "market" : "markets"}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyRegion === region}
                        onClick={() => linkRegion(region)}
                      >
                        {busyRegion === region ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                        Link
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {/* All regions covered */}
          {availableRegions.length === 0 && passport ? (
            <div className="mt-8 flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/40 px-5 py-6 text-sm text-muted-foreground">
              <Check className="size-4 text-primary" />
              Every region is linked to your passport.
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}

function LinkedCard({
  link,
  busy,
  onManage,
  onUnlink,
}: {
  link: PassportLink
  busy: boolean
  onManage: () => void
  onUnlink: () => void
}) {
  const d = describeRegion(link.region)
  const linkedOn = (() => {
    const t = Date.parse(link.linkedAt)
    return Number.isNaN(t) ? null : new Date(t).toLocaleDateString()
  })()

  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
            <Globe2 className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-foreground">{d.name}</h3>
              {d.special ? (
                <Lock className="size-3.5 text-muted-foreground" />
              ) : null}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{link.email}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5" />
              {d.hostingName || "—"}
              {d.hostingCode ? ` (${d.hostingCode})` : ""}
              {linkedOn ? ` · linked ${linkedOn}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onManage}>
            Manage
            <ExternalLink className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={onUnlink}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Unlink className="size-4" />
            )}
            Unlink
          </Button>
        </div>
      </div>
    </li>
  )
}
