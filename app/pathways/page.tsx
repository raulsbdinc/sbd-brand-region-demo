"use client"

import Link from "next/link"
import { ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { BRANDS } from "@/lib/brands"
import { METHODS } from "@/lib/methods"
import { cn } from "@/lib/utils"

export default function PathwaysPage() {
  const { brand, startFlow } = useApp()
  const b = BRANDS[brand]

  const featured = METHODS.filter((m) => m.featured)
  const rest = METHODS.filter((m) => !m.featured)

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="text-center">
        <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Choose how you want to sign in
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Pick a path to see the {b.name} account journey. Some paths use Auth0
          when configured. Others are demo-only walkthroughs.
        </p>
      </div>

      {/* Featured method */}
      {featured.map((m) => {
        const Icon = m.icon
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => startFlow(m.id)}
            className="mt-8 flex w-full items-center gap-4 rounded-2xl border-2 border-primary bg-card p-5 text-left transition-shadow hover:shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Icon className="size-6" />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-2">
                <span className="text-lg font-bold text-foreground">{m.name}</span>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                  Recommended
                </span>
              </span>
              <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                {m.description}
              </span>
            </span>
            <ArrowRight className="size-5 shrink-0 text-muted-foreground" />
          </button>
        )
      })}

      {/* Other methods */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {rest.map((m) => {
          const Icon = m.icon
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => startFlow(m.id)}
              className={cn(
                "flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <Icon className="size-5" />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{m.name}</span>
                  {m.live ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                      <ShieldCheck className="size-3" />
                      Uses Auth0
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {m.description}
                </span>
                <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {m.tag}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* The generic real login. Social and Classic password above are also
          real (marked "Live"); this is the no-frills entry point straight to
          Universal Login, kept visually distinct for testers. */}
      <Link
        href="/live"
        className="mt-8 flex w-full items-center gap-4 rounded-2xl border border-dashed border-primary/50 bg-primary/5 p-5 text-left transition-colors hover:bg-primary/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck className="size-6" />
        </span>
        <span className="flex-1">
          <span className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">Try the Auth0 login</span>
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
              When configured
            </span>
          </span>
          <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
            Go to Auth0 Universal Login without choosing a provider first. This
            works only when this deployment has valid Auth0 settings.
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground" />
      </Link>

      <div className="mt-8 flex items-center justify-center">
        <Link
          href="/journeys"
          className="inline-flex items-center gap-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
        >
          Not sure which to pick? Compare all methods
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </main>
  )
}
