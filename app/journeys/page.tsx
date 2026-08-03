"use client"

import { ArrowRight } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { METHODS } from "@/lib/methods"
import { Button } from "@/components/ui/button"

export default function JourneysPage() {
  const { startFlow } = useApp()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Compare every sign-in method
        </h1>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
          A factual side-by-side of all seven customer journeys — steps, effort,
          what a tester needs on hand, and the security property of each. Launch
          any one to experience it.
        </p>
      </div>

      {/* Desktop table */}
      <div className="mt-8 hidden overflow-hidden rounded-2xl border border-border lg:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left">
              <th className="px-4 py-3 font-semibold">Method</th>
              <th className="px-4 py-3 font-semibold">Steps</th>
              <th className="px-4 py-3 font-semibold">Effort</th>
              <th className="px-4 py-3 font-semibold">Typical time</th>
              <th className="px-4 py-3 font-semibold">You need</th>
              <th className="px-4 py-3 font-semibold">Security note</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {METHODS.map((m) => {
              const Icon = m.icon
              return (
                <tr key={m.id} className="border-t border-border align-top">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <Icon className="size-4 text-primary" />
                      {m.name}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">{m.steps}</td>
                  <td className="px-4 py-4 text-muted-foreground">{m.taps}</td>
                  <td className="px-4 py-4 text-muted-foreground">{m.time}</td>
                  <td className="px-4 py-4 text-muted-foreground">{m.needs}</td>
                  <td className="px-4 py-4 text-muted-foreground">{m.security}</td>
                  <td className="px-4 py-4">
                    <Button size="sm" variant="secondary" onClick={() => startFlow(m.id)}>
                      Try
                      <ArrowRight className="size-4" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mt-8 grid gap-4 lg:hidden">
        {METHODS.map((m) => {
          const Icon = m.icon
          return (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Icon className="size-5 text-primary" />
                <h2 className="font-bold text-foreground">{m.name}</h2>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Row label="Steps" value={String(m.steps)} />
                <Row label="Effort" value={m.taps} />
                <Row label="Typical time" value={m.time} />
                <Row label="You need" value={m.needs} />
              </dl>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {m.security}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => startFlow(m.id)}
              >
                Try this method
                <ArrowRight className="size-4" />
              </Button>
            </div>
          )
        })}
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}
