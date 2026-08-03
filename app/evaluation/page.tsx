import type { Metadata } from "next"
import Link from "next/link"
import { EvaluationMatrix } from "@/components/evaluation-matrix"
import {
  EVAL_STATUS_META,
  EVAL_STATUS_ORDER,
  evalSummary,
} from "@/lib/ciam-evaluation"

export const metadata: Metadata = {
  title: "CIAM Evaluation — SBD Sign-In Experience",
  description:
    "POC assessment showing what this repository demonstrates, what was not tested, and what production work remains.",
}

export default function EvaluationPage() {
  const summary = evalSummary()

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      {/* Hero */}
      <header className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">POC</p>
        <h1 className="mt-3 text-balance text-4xl font-extrabold tracking-tight">
          CIAM evaluation
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          This assessment compares the repository with the CIAM evaluation sheet
          from 6 June 2026. POC status says what was built or tested here.
          Documented support says what vendor documents describe; it does not mean
          that production setup or integration is complete.
        </p>
      </header>

      {/* Why the statuses matter */}
      <section className="mt-10 rounded-lg border border-border bg-muted/30 p-5">
        <h2 className="text-sm font-semibold text-foreground">
          POC evidence and documented support
        </h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
          Not every requirement needs custom code. The implementation status stays
          honest about what was exercised here, while official Auth0/Okta evidence
          confirms the broader platform direction. Integration, governance, legal,
          and specialist-service responsibilities remain explicitly assigned to
          SBD or its delivery partners.
        </p>
      </section>

      {/* Summary counts */}
      <section className="mt-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {EVAL_STATUS_ORDER.map((status) => {
            const meta = EVAL_STATUS_META[status]
            return (
              <div key={status} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                  <span className="text-2xl font-bold tabular-nums">
                    {summary.counts[status]}
                  </span>
                </div>
                <p className="mt-1 text-xs font-medium text-foreground">{meta.label}</p>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {summary.total} requirements from the evaluation sheet.
        </p>
      </section>

      {/* Legend */}
      <section className="mt-8 border-t border-border pt-8">
        <h2 className="text-sm font-semibold text-foreground">What each status means</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {EVAL_STATUS_ORDER.map((status) => {
            const meta = EVAL_STATUS_META[status]
            return (
              <div key={status} className="rounded-lg border border-border p-3">
                <dt className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                  <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {meta.description}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      {/* Matrix */}
      <section className="mt-12">
        <EvaluationMatrix />
      </section>

      {/* Footer note */}
      <footer className="mt-14 border-t border-border pt-6 text-sm text-muted-foreground">
        <p className="text-pretty">
          The final conclusion, official sources, prerequisites, and ownership
          boundaries live in the{" "}
          <Link
            href="/docs?doc=coverage"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Auth0 coverage guide
          </Link>
          . The production enablement handoff is in the{" "}
          <Link
            href="/docs?doc=features"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            feature backlog
          </Link>
          , and the multi-region tenant model is at{" "}
          <Link
            href="/architecture"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            architecture
          </Link>
          .
        </p>
      </footer>
    </main>
  )
}
