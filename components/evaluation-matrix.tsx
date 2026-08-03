"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink, FileCheck2, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  CIAM_CATEGORIES,
  EVAL_STATUS_META,
  EVAL_STATUS_ORDER,
  type EvalStatus,
  type Priority,
} from "@/lib/ciam-evaluation"
import { SUPPORT_META, SUPPORT_ORDER, type SupportType } from "@/lib/ciam-evidence"

const PRIORITY_CLASS: Record<Priority, string> = {
  "Must Have": "bg-foreground text-background",
  "Nice to Have": "bg-muted text-foreground",
  TBD: "border border-border text-muted-foreground",
  "N/A": "border border-border text-muted-foreground",
}

function StatusChip({ status }: { status: EvalStatus }) {
  const meta = EVAL_STATUS_META[status]
  return <span className={cn("inline-flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", meta.chip)}><span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />{meta.label}</span>
}

function SupportChip({ support }: { support: SupportType }) {
  const meta = SUPPORT_META[support]
  return <span className={cn("inline-flex flex-none items-center rounded-full border px-2.5 py-1 text-xs font-medium", meta.chip)}>{meta.label}</span>
}

export function EvaluationMatrix() {
  const [activeStatus, setActiveStatus] = useState<EvalStatus | null>(null)
  const [activeSupport, setActiveSupport] = useState<SupportType | null>(null)

  const supportCounts = useMemo(() => {
    const counts = Object.fromEntries(SUPPORT_ORDER.map((support) => [support, 0])) as Record<SupportType, number>
    for (const category of CIAM_CATEGORIES) for (const requirement of category.requirements) counts[requirement.support] += 1
    return counts
  }, [])

  const visibleCategories = useMemo(() => CIAM_CATEGORIES.map((category) => ({
    ...category,
    requirements: category.requirements.filter((requirement) =>
      (!activeStatus || requirement.status === activeStatus) &&
      (!activeSupport || requirement.support === activeSupport)),
  })).filter((category) => category.requirements.length > 0), [activeStatus, activeSupport])

  return (
    <div className="flex flex-col gap-10">
      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="two-questions-title">
        <div className="flex items-start gap-3">
          <div className="flex size-10 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileCheck2 className="size-5" aria-hidden="true" /></div>
          <div className="flex flex-col gap-2">
            <h2 id="two-questions-title" className="text-lg font-bold tracking-tight">Two questions, kept deliberately separate</h2>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">POC status</strong> says what this repository demonstrates. <strong className="text-foreground">Documented support</strong> says how Auth0/Okta and SBD would deliver the production requirement. Official documentation validates platform direction; it does not pretend an integration is already deployed.</p>
            <Link href="/docs?doc=coverage" className="w-fit text-sm font-semibold text-primary underline-offset-4 hover:underline">Read the complete Auth0 coverage guide</Link>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="support-summary-title">
        <div><p className="text-xs font-bold uppercase tracking-wider text-primary">Documented delivery model</p><h2 id="support-summary-title" className="mt-1 text-xl font-bold tracking-tight">Auth0 is the foundation; ownership stays explicit</h2></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SUPPORT_ORDER.map((support) => <button key={support} type="button" onClick={() => setActiveSupport(activeSupport === support ? null : support)} aria-pressed={activeSupport === support} className={cn("flex flex-col items-start gap-2 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", activeSupport === support ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40")}><span className="text-2xl font-extrabold tabular-nums">{supportCounts[support]}</span><SupportChip support={support} /><span className="text-xs leading-relaxed text-muted-foreground">{SUPPORT_META[support].description}</span></button>)}
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-label="Requirement filters">
        <div className="flex flex-col gap-2"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Filter by POC status</p><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setActiveStatus(null)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring", activeStatus === null ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}>All statuses</button>{EVAL_STATUS_ORDER.map((status) => { const meta = EVAL_STATUS_META[status]; return <button key={status} type="button" onClick={() => setActiveStatus(activeStatus === status ? null : status)} aria-pressed={activeStatus === status} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", activeStatus === status ? meta.chip : "border-border text-muted-foreground hover:bg-muted/50")}><span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />{meta.label}</button>})}</div></div>
        {activeSupport ? <button type="button" onClick={() => setActiveSupport(null)} className="w-fit text-xs font-semibold text-primary underline-offset-4 hover:underline">Clear documented-support filter: {SUPPORT_META[activeSupport].label}</button> : null}
      </section>

      <div className="flex flex-col gap-12">
        {visibleCategories.map((category) => <section key={category.id} id={category.id} className="scroll-mt-24">
          <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2"><h2 className="text-xl font-bold tracking-tight">{category.title}</h2><span className="flex-none text-sm text-muted-foreground">{category.requirements.length} {category.requirements.length === 1 ? "requirement" : "requirements"}</span></div>
          <ul className="mt-4 flex flex-col gap-3">{category.requirements.map((req) => <li key={req.requirement} className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h3 className="text-pretty font-semibold leading-snug text-foreground">{req.requirement}</h3><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className={cn("rounded-full px-2 py-0.5 font-medium", PRIORITY_CLASS[req.priority])}>{req.priority}</span><span>In POC: {req.inPoc}</span></div></div><div className="flex flex-wrap gap-2 sm:justify-end"><StatusChip status={req.status} /><SupportChip support={req.support} /></div></div>
            <div className="mt-4 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
              <div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">What the POC proves</p><p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{req.detail}</p></div>
              <div><p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Wrench className="size-3.5" aria-hidden="true" />Production delivery</p><p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{req.responsibility}</p>{req.prerequisite ? <p className="mt-2 text-xs font-medium text-foreground">Prerequisite: {req.prerequisite}</p> : null}</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label="Official documentation">{req.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline">{source.label}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>)}</div>
          </li>)}</ul>
        </section>)}
      </div>
      {visibleCategories.length === 0 ? <p className="text-sm text-muted-foreground">No requirements match these filters.</p> : null}
    </div>
  )
}
