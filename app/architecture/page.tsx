"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import {
  ArrowLeftRight,
  Clock,
  Cookie,
  Database,
  GitMerge,
  Layers,
  Link2,
  Lock,
  LogIn,
  MapPin,
  Scale,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from "lucide-react"
import {
  COOKIE_LABELS,
  CURRENT_POC,
  HOSTING_REGIONS,
  HOSTING_REGION_ORDER,
  MARKETS,
  PRIVACY_REGIMES,
  TENANTS,
  TRANSFER_LABELS,
  marketsForTenant,
  regimesForTenant,
  standardTenantCount,
  totalMarkets,
  type CookieModel,
  type Tenant,
  type TransferRule,
} from "@/lib/regions"
import {
  DOWNSTREAM_SYSTEMS,
  ERASURE_ACTION_LABELS,
  ERASURE_GRACE_PERIOD_DAYS,
  ERASURE_SLA_DAYS,
  type ErasureAction,
} from "@/lib/erasure"
import { cn } from "@/lib/utils"

const PRINCIPLES = [
  {
    icon: Scale,
    title: "Group by privacy law first",
    body: "Markets only share a tenant when their privacy law and data-transfer rules allow their data to be hosted in the same region.",
  },
  {
    icon: MapPin,
    title: "Then by location",
    body: "Within what the law allows, we group markets that are near each other (and share an SBD office) so data has less distance to travel.",
  },
  {
    icon: Layers,
    title: "Use as few tenants as possible",
    body: "Many markets have fewer than 100 active users a month, so we group them together instead of running dozens of near-empty tenants.",
  },
]

const CROSS_TENANT_PATTERNS = [
  {
    icon: GitMerge,
    title: "Fan-out aggregation",
    body: "A machine-to-machine app inside each tenant, plus a service that calls every tenant's admin API and merges the results on demand. Simple to build; the real question is where the merged data is allowed to live.",
  },
  {
    icon: Server,
    title: "Log streams or scheduled export",
    body: "Stream each tenant's events or export its users into a central warehouse for reporting. Same residency rule applies to wherever that warehouse is hosted.",
  },
  {
    icon: Users,
    title: "Okta cross-tenant tooling",
    body: "Okta's paid add-ons (Org2Org, a hub tenant, or enterprise multi-tenant admin) can bridge tenants. These are extra licensing, not part of the standard setup.",
  },
]

const SELF_SERVICE_STEPS = [
  {
    icon: LogIn,
    title: "Log in to each tenant (OIDC)",
    body: "The central app is registered inside every regional tenant. To manage their Europe account the user logs in against the Europe tenant; for the Americas, the Americas tenant. Every login proves the user controls that account — which is why this is allowed where an admin aggregate view is not.",
  },
  {
    icon: UserCog,
    title: "Edit via that tenant's Management API",
    body: "Once authenticated, the app uses that tenant's credentials to read and update that user's profile, MFA, and consent — the same account self-service the app already does, just pointed at whichever tenant the user picked.",
  },
  {
    icon: Link2,
    title: "An optional account-linking map",
    body: "To show one dashboard of all their regional accounts, store only a mapping of which logins are the same person — identifiers, never profile data. The profile itself stays in each region.",
  },
]

const COOKIE_TONE: Record<CookieModel, string> = {
  "opt-in": "bg-primary/10 text-primary",
  "opt-out": "bg-muted text-foreground",
  notice: "bg-muted text-muted-foreground",
}

const TRANSFER_TONE: Record<TransferRule, string> = {
  strict: "bg-primary/10 text-primary",
  safeguard: "bg-muted text-foreground",
  none: "bg-muted text-muted-foreground",
  unique: "bg-destructive/10 text-destructive",
}

const ERASURE_ACTION_TONE: Record<ErasureAction, string> = {
  delete: "bg-destructive/10 text-destructive",
  anonymize: "bg-primary/10 text-primary",
  "retain-legal": "bg-muted text-muted-foreground",
}

type RegionStatus = {
  active: string
  authConfigured: boolean
  regions: { id: string; name: string; configured: boolean; dedicated: boolean }[]
}

const regionFetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<RegionStatus>)

export default function ArchitecturePage() {
  const [activeId, setActiveId] = useState(TENANTS[0].id)
  const active = TENANTS.find((t) => t.id === activeId) as Tenant

  const { data: regionStatus } = useSWR<RegionStatus>("/api/region", regionFetcher)
  const selectedRegionId = regionStatus?.active
  const selectedRegion = selectedRegionId ? TENANTS.find((t) => t.id === selectedRegionId) : undefined
  const selectedRegionStatus = regionStatus?.regions.find((r) => r.id === selectedRegionId)

  // Auto-focus the tenant tab matching the region picked in the header — once.
  const syncedRef = useRef(false)
  useEffect(() => {
    if (syncedRef.current || !selectedRegionId) return
    if (TENANTS.some((t) => t.id === selectedRegionId)) {
      setActiveId(selectedRegionId)
      syncedRef.current = true
    }
  }, [selectedRegionId])
  const activeHosting = HOSTING_REGIONS[active.hosting]
  const activeMarkets = marketsForTenant(active.id)
  const activeRegimes = regimesForTenant(active.id)

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      {/* Header */}
      <header className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">Identity platform architecture</p>
        <h1 className="mt-3 text-balance text-4xl font-extrabold tracking-tight">Regions, tenants &amp; sites</h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          A proposed model for how SBD <em>could</em> run one identity platform worldwide: a tenant per region, an
          application per site, and customer data hosted where each market&apos;s privacy law requires. This is the
          target we are testing with the proof of concept — not a final decision.
        </p>
        <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
          The proposal below covers every market where SBD has a legal entity, grouped into as few tenants as the
          rules allow — by privacy law first and location second.
        </p>
      </header>

      {/* Business case */}
      <section className="mt-14 grid gap-8 sm:grid-cols-3">
        <Stat
          label="Platform under test"
          value="Auth0 / Okta"
          note="The target platform for this proof of concept — real logins already work against the SBD tenant."
        />
        <Stat
          label="Pricing"
          value="Per monthly active user"
          note="Keeps cost low for our many sites with under 50 active users a month."
        />
        <Stat
          label="Proposed footprint"
          value={`${standardTenantCount()} tenants + China`}
          note={`Covering all ${totalMarkets()} markets where SBD has a legal entity.`}
        />
      </section>

      {/* Principles */}
      <section className="mt-16 border-t border-border pt-12">
        <h2 className="text-xl font-bold tracking-tight">How we grouped the markets</h2>
        <div className="mt-8 grid gap-10 sm:grid-cols-3">
          {PRINCIPLES.map((p) => {
            const Icon = p.icon
            return (
              <div key={p.title}>
                <Icon className="size-6 text-primary" />
                <h3 className="mt-3 font-bold text-foreground">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Tenant explorer */}
      <section className="mt-16 border-t border-border pt-12">
        <h2 className="text-xl font-bold tracking-tight">The proposed tenants</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          Pick a tenant to see where its data is hosted, why these markets sit together, and the countries it covers.
        </p>

        {/* Tabs */}
        <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Tenants">
          {TENANTS.map((t) => {
            const isActive = t.id === active.id
            const host = HOSTING_REGIONS[t.hosting]
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(t.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  t.special
                    ? isActive
                      ? "bg-destructive text-white focus-visible:ring-destructive"
                      : "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/30 hover:bg-destructive/15"
                    : isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground hover:bg-muted/70",
                )}
              >
                {t.special ? <ShieldAlert className="size-4" /> : <span className="text-xs font-bold opacity-70">{host.code}</span>}
                {t.name}
                {t.special && <span className="text-xs font-bold uppercase tracking-wide opacity-80">Not available</span>}
                {t.id === selectedRegionId && (
                  <span
                    aria-label="Active region"
                    title="Currently selected in the header region switcher"
                    className={cn(
                      "size-1.5 rounded-full",
                      isActive ? "bg-current" : "bg-primary",
                    )}
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Detail */}
        <div className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-2xl font-bold tracking-tight">{active.name}</h3>
              {active.special && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
                  <ShieldAlert className="size-3.5" />
                  Not available on Okta
                </span>
              )}
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-sm font-medium",
                active.special ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <Server className={cn("size-4", active.special ? "text-destructive" : "text-primary")} />
              {active.special ? "No in-country Okta region" : `Hosted in ${activeHosting.name} (${activeHosting.code})`}
            </span>
          </div>
          {active.special ? (
            <div className="mt-3 rounded-lg border-l-2 border-destructive bg-destructive/5 py-2 pl-4 pr-3 text-destructive">
              China can&apos;t be served by the standard Okta regions — it needs a separate, in-country approach and is
              handled on its own.
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground">
              {`${activeMarkets.length} markets · ${activeRegimes.length} privacy laws · one application per brand storefront (${active.brands.join(", ")}).`}
            </p>
          )}

          {/* Markets */}
          <div className="mt-8">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Markets in this tenant
            </h4>
            <div className="mt-3 max-h-[28rem] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-background text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-semibold">Market</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Locale</th>
                    <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Privacy law</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Cookies</th>
                    <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">Transfers</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMarkets.map((m) => {
                    const regime = PRIVACY_REGIMES[m.regime]
                    return (
                      <tr key={m.a2} className="border-b border-border/60">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex min-w-7 justify-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                              {m.a2}
                            </span>
                            <span className="font-medium text-foreground">{m.country}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{m.locale}</td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">{regime.law}</td>
                        <td className="px-3 py-2.5">
                          <span className={cn("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", COOKIE_TONE[regime.cookie])}>
                            {COOKIE_LABELS[regime.cookie]}
                          </span>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          <span className={cn("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", TRANSFER_TONE[regime.transfer])}>
                            {TRANSFER_LABELS[regime.transfer]}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reasoning */}
          <dl className="mt-10 space-y-6">
            <Reason icon={Scale} label="Privacy" body={active.privacy} />
            <Reason icon={MapPin} label="Location" body={active.proximity} />
            <Reason icon={Layers} label="Why group them" body={active.optimization} />
          </dl>

          {/* Levers */}
          <div className="mt-8">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              When we&apos;d split a market out
            </h4>
            <ul className="mt-3 space-y-2">
              {active.levers.map((l) => (
                <li key={l} className="flex gap-2.5 leading-relaxed text-foreground">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Privacy rules key */}
      <section className="mt-16 border-t border-border pt-12">
        <h2 className="text-xl font-bold tracking-tight">What the privacy labels mean</h2>
        <div className="mt-8 grid gap-10 sm:grid-cols-2">
          <Legend
            icon={Cookie}
            title="Cookie consent"
            items={[
              [COOKIE_LABELS["opt-in"], "The user must say yes before any non-essential cookies run."],
              [COOKIE_LABELS["opt-out"], "Cookies may run, but the user must be given a clear way to turn them off."],
              [COOKIE_LABELS.notice, "You must tell the user; their consent is assumed or not required by law."],
            ]}
          />
          <Legend
            icon={ArrowLeftRight}
            title="Sending data abroad"
            items={[
              [TRANSFER_LABELS.strict, "Allowed only with an approved destination, standard contract clauses, or a similar method."],
              [TRANSFER_LABELS.safeguard, "Allowed with safeguards in place; the company sending the data stays responsible for it."],
              [TRANSFER_LABELS.none, "No restriction on data leaving the country."],
              [TRANSFER_LABELS.unique, "Data must stay in the country and needs special approval (China)."],
            ]}
          />
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          This is a planning aid for engineering, not legal advice. Check each market&apos;s rules with Legal and
          against the SBD Global Privacy Policy.
        </p>
      </section>

      {/* Hosting regions */}
      <section className="mt-16 border-t border-border pt-12">
        <h2 className="text-xl font-bold tracking-tight">Okta hosting regions</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          Okta offers these six hosting locations. The proposed map assigns one to
          each planned tenant. Only the shared POC tenant is connected today.
        </p>
        <ul className="mt-8 divide-y divide-border">
          {HOSTING_REGION_ORDER.map((id) => {
            const r = HOSTING_REGIONS[id]
            const tenants = TENANTS.filter((t) => !t.special && t.hosting === id)
            const marketCount = MARKETS.filter((m) => tenants.some((t) => t.id === m.tenant)).length
            return (
              <li key={r.id} className="flex items-center gap-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-foreground">
                  {r.code}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground">{r.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {tenants.length > 0
                      ? `${tenants.map((t) => t.name).join(", ")} · ${marketCount} markets`
                      : "Available — a market can move here later if its rules require it"}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Cross-tenant user view */}
      <section className="mt-16 border-t border-border pt-12">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Can we see all users across tenants?</h2>
        </div>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
          Not on its own. Each tenant is a sealed box: its admin API and dashboard only ever return{" "}
          <span className="font-medium text-foreground">that tenant&apos;s</span> users. There is no built-in
          &ldquo;every user, everywhere&rdquo; view — and that is deliberate. Because we split tenants so each
          market&apos;s data stays in its own region, one global user list would pull, say, EU personal data into a
          single system, which is exactly the cross-border problem this whole model avoids.
        </p>

        <div className="mt-6 flex max-w-3xl gap-3 rounded-lg border-l-2 border-primary bg-muted/40 py-3 pl-4 pr-4">
          <Lock className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Tenant isolation supports the proposed residency model.</span>{" "}
            Legal and privacy teams still need to approve the final tenant map and data flows.
          </p>
        </div>

        <p className="mt-8 font-semibold text-foreground">If we do need an aggregate view, we build one — carefully:</p>
        <ol className="mt-4 space-y-4">
          {CROSS_TENANT_PATTERNS.map((p, i) => {
            const Icon = p.icon
            return (
              <li key={p.title} className="flex gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <Icon className="size-4 text-primary" />
                    {p.title}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-6 flex max-w-3xl gap-3 rounded-lg border border-border p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">The catch for all three:</span> any combined store brings
            back the cross-border question. Prefer aggregating de-identified metrics (accounts per market, residency
            checks) over raw personal data, and host any merged store where the strictest contributing region allows —
            usually the EU. This is a governed reporting pipeline, not an admin shortcut.
          </p>
        </div>
      </section>

      {/* User self-service across tenants */}
      <section className="mt-16 border-t border-border pt-12">
        <div className="flex items-center gap-2">
          <UserCog className="size-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Can a user manage themselves across tenants?</h2>
        </div>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
          A central self-service app is possible, but this POC does not complete
          it. A person would need to sign in to each regional tenant. The app could
          then send each change to the tenant that owns that account. The final
          design still needs privacy, security, and session-flow review.
        </p>

        <ol className="mt-6 space-y-4">
          {SELF_SERVICE_STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <li key={s.title} className="flex gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <Icon className="size-4 text-primary" />
                    {s.title}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="mt-6 flex max-w-3xl gap-3 rounded-lg border-l-2 border-primary bg-muted/40 py-3 pl-4 pr-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">The POC has an account editor and a link-record demo.</span>{" "}
            It still needs real sign-in to each regional tenant, account ownership
            checks, session handoff, and production review.
          </p>
        </div>
      </section>

      {/* Right to be forgotten */}
      <section className="mt-16 border-t border-border pt-12">
        <div className="flex items-center gap-2">
          <Trash2 className="size-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Right to be forgotten across regions</h2>
        </div>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
          Deleting an Auth0 identity does not delete data held by other SBD
          systems. This POC can block the Auth0 user by default, or hard-delete the
          user when explicitly enabled. It can also send one best-effort webhook
          when configured. It does not prove that downstream systems completed
          erasure.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Reason
            icon={Trash2}
            label="Erase the identity"
            body="The account center blocks and flags the Auth0 user by default. Hard deletion runs only when the deployment explicitly enables it."
          />
          <Reason
            icon={GitMerge}
            label="Cascade downstream"
            body="When a webhook URL is configured, the app sends one best-effort request with the planned systems. A successful send is not proof that any downstream system deleted data."
          />
          <Reason
            icon={Lock}
            label="Stay in region"
            body="The receipt records the selected home region. The POC does not deploy regional workers or verify where a downstream webhook processes the request."
          />
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <Database className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">The downstream cascade</span>
          </div>
          <ul className="divide-y divide-border">
            {DOWNSTREAM_SYSTEMS.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.holds}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.note}</p>
                </div>
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    ERASURE_ACTION_TONE[s.action],
                  )}
                >
                  {ERASURE_ACTION_LABELS[s.action]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex max-w-3xl gap-3 rounded-lg border-l-2 border-primary bg-muted/40 py-3 pl-4 pr-4">
          <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Timing shown by the POC.</span> The receipt calculates a
            {" "}{ERASURE_GRACE_PERIOD_DAYS}-day soft-delete window and a
            {" "}{ERASURE_SLA_DAYS}-day target date. The app does not run a worker
            that finalizes deletion or checks downstream completion. A request
            produces a status receipt with a stable id, readable at{" "}
            <span className="font-mono text-foreground">GET /api/account/erasure</span> and exercised from{" "}
            <a href="/account" className="font-medium text-primary underline-offset-2 hover:underline">
              the account center
            </a>
            .
          </p>
        </div>
      </section>

      {/* Today */}
      <section className="mt-16 border-t border-border pt-12">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Where the proof of concept is today</h2>
        </div>
        <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
          Everything above is the <span className="font-medium text-foreground">target</span> architecture. Right now
          this app connects to one application (&ldquo;{CURRENT_POC.app}&rdquo;) inside one demo tenant (
          <span className="font-mono text-foreground">{CURRENT_POC.tenant}</span>), hosted in the{" "}
          {HOSTING_REGIONS[CURRENT_POC.hosting].name} region. {CURRENT_POC.note} Moving to the full map above is setup
          and configuration work — what the customer sees at sign-in stays the same.
        </p>

        <div className="mt-6 flex max-w-3xl gap-3 rounded-lg border border-border bg-muted/40 p-4">
          <Server className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold text-foreground">Region routing is wired up</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              The <span className="font-medium text-foreground">region switcher</span> sets a region cookie used by
              the Auth0 proxy. Every region currently falls back to the same shared
              POC app unless separate regional credentials are supplied. The
              switcher therefore does not prove that dedicated regional tenants
              exist.
            </p>
            {selectedRegion && (
              <p className="mt-2 text-sm text-foreground">
                Active region:{" "}
                <span className="font-semibold">{selectedRegion.name}</span>
                {selectedRegionStatus && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {selectedRegionStatus.dedicated ? "dedicated tenant" : "shared POC app"}
                  </span>
                )}
                . Change it from the header region switcher.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold text-foreground">{value}</div>
      <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{note}</div>
    </div>
  )
}

function Reason({ icon: Icon, label, body }: { icon: typeof ShieldCheck; label: string; body: string }) {
  return (
    <div className="flex gap-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
      <div>
        <dt className="font-semibold text-foreground">{label}</dt>
        <dd className="mt-1 leading-relaxed text-muted-foreground">{body}</dd>
      </div>
    </div>
  )
}

function Legend({ icon: Icon, title, items }: { icon: typeof ShieldCheck; title: string; items: [string, string][] }) {
  return (
    <div>
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <Icon className="size-4 text-primary" />
        {title}
      </div>
      <dl className="mt-4 space-y-3">
        {items.map(([term, desc]) => (
          <div key={term} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="shrink-0 text-sm font-semibold text-foreground sm:w-40">{term}</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">{desc}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
