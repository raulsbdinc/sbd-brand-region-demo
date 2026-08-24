"use client"

import Link from "next/link"
import { useState } from "react"
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Network,
  ShieldCheck,
} from "lucide-react"
import {
  IDENTITY_USE_CASES,
  type IdentityUseCaseId,
  identityUseCaseById,
} from "@/lib/identity-use-cases"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const LIVE_DEMO_URLS = [
  { label: "DeWalt France", href: "https://sbd-demo-dewalt-fr.vercel.app" },
  { label: "DeWalt Germany", href: "https://sbd-demo-dewalt-de.vercel.app" },
  { label: "Stanley France", href: "https://sbd-demo-stanley-fr.vercel.app" },
]

export function IdentityUseCaseLab() {
  const [selectedId, setSelectedId] = useState<IdentityUseCaseId>("baseline")
  const [revealedSteps, setRevealedSteps] = useState(0)
  const selected = identityUseCaseById(selectedId)
  const isLive = selected.status === "live"

  function selectUseCase(id: IdentityUseCaseId) {
    setSelectedId(id)
    setRevealedSteps(0)
  }

  function revealNextStep() {
    setRevealedSteps((current) => Math.min(current + 1, selected.steps.length))
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">CIAM stakeholder decision</p>
        <h1 className="mt-2 text-balance text-3xl font-extrabold sm:text-4xl">
          Four identity models, one clear choice
        </h1>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
          Compare what each model means for a customer, the identity directory,
          and the operational work that follows. The shared-account paths use the
          current EU tenant; the independent-password paths show the separate
          topology they require.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Identity models"
        className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {IDENTITY_USE_CASES.map((useCase) => {
          const active = useCase.id === selectedId
          return (
            <button
              key={useCase.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectUseCase(useCase.id)}
              className={cn(
                "min-h-16 border px-3 py-2 text-left text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {useCase.label}
            </button>
          )
        })}
      </div>

      <section
        role="tabpanel"
        className="mt-5 border border-border bg-background"
        aria-label={selected.title}
      >
        <div className="grid gap-6 border-b border-border p-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:p-7">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isLive ? "default" : "secondary"}>
                {isLive ? "Live in current demo" : "Isolated topology required"}
              </Badge>
              {isLive ? <CheckCircle2 className="size-4 text-primary" aria-hidden="true" /> : <CircleDashed className="size-4 text-muted-foreground" aria-hidden="true" />}
            </div>
            <h2 className="mt-3 text-2xl font-bold">{selected.title}</h2>
            <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
              {selected.summary}
            </p>
          </div>
          <div className="border-l-0 border-border lg:border-l lg:pl-6">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Credential model</p>
            <p className="mt-2 text-sm leading-relaxed">{selected.credentials}</p>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-2">
          <div className="border-b border-border p-5 lg:border-r lg:border-b-0 lg:p-7">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Network className="size-4 text-primary" aria-hidden="true" />
              Directory topology
            </div>
            <p className="mt-3 leading-relaxed text-muted-foreground">{selected.topology}</p>
          </div>
          <div className="p-5 lg:p-7">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Decision trade-off
            </div>
            <p className="mt-3 leading-relaxed text-muted-foreground">{selected.tradeoff}</p>
          </div>
        </div>

        <div className="border-t border-border p-5 lg:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Walk through the account journey</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Reveal each required identity step in order.
              </p>
            </div>
            {revealedSteps < selected.steps.length ? (
              <Button size="sm" onClick={revealNextStep}>
                Next step
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setRevealedSteps(0)}>
                Replay
              </Button>
            )}
          </div>

          <ol className="mt-5 grid gap-3 md:grid-cols-2">
            {selected.steps.map((step, index) => {
              const visible = index < revealedSteps
              return (
                <li
                  key={step}
                  className={cn(
                    "flex min-h-20 gap-3 border p-4 transition-opacity",
                    visible ? "border-border bg-muted/35" : "border-dashed border-border opacity-45",
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold">
                    {index + 1}
                  </span>
                  <span className="text-sm leading-relaxed">{visible ? step : "Step ready"}</span>
                </li>
              )
            })}
          </ol>
        </div>

        {isLive ? (
          <div className="border-t border-border bg-muted/25 p-5 lg:p-7">
            <h3 className="font-semibold">Run this model on the live storefronts</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {LIVE_DEMO_URLS.map((site) => (
                <Button key={site.href} variant="outline" size="sm" nativeButton={false} render={<Link href={site.href} target="_blank" rel="noreferrer" />}>
                  {site.label}
                  <ExternalLink className="size-4" />
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-t border-border bg-muted/25 p-5 text-sm leading-relaxed text-muted-foreground lg:p-7">
            This is an executable decision walkthrough. Authenticating this model
            requires its own temporary database connection(s), seeded test
            credentials, and connection-aware sign-in routing; those are kept
            separate from the live shared-account path until stakeholders select
            this model.
          </div>
        )}
      </section>
    </main>
  )
}
