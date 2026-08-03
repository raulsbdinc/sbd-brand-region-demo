import type { Metadata } from "next"
import {
  CHANGELOG,
  CURRENT_VERSION,
  TARGET_VERSION,
  type ChangeKind,
} from "@/lib/changelog"

export const metadata: Metadata = {
  title: "Changelog — SBD Sign-In Experience",
  description:
    "What changed in the SBD Sign-In Experience prototype, version by version.",
}

const KIND_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  removed: "Removed",
}

const KIND_CLASS: Record<ChangeKind, string> = {
  added: "bg-primary/10 text-primary",
  changed: "bg-muted text-foreground",
  fixed: "bg-primary/10 text-primary",
  removed: "bg-destructive/10 text-destructive",
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export default function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <header className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">Changelog</p>
        <h1 className="mt-3 text-balance text-4xl font-extrabold tracking-tight">
          What has changed
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          A version-by-version record of the prototype. The current build is{" "}
          <span className="font-semibold text-foreground">{CURRENT_VERSION}</span>.
          Each iteration gets its own version.
        </p>
      </header>

      <div className="mt-8 rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-semibold">Road to {TARGET_VERSION}.</span>{" "}
          We are treating today&apos;s prototype as {CURRENT_VERSION} and adding a version
          each iteration. {TARGET_VERSION} is the point where the agreed POC scope
          is complete. Until then, expect the version to move in small steps as
          methods and account features are promoted from mock to real.
        </p>
      </div>

      <ol className="mt-10 space-y-10 border-t border-border pt-10">
        {CHANGELOG.map((entry) => (
          <li key={entry.version} className="grid gap-4 md:grid-cols-[10rem_1fr]">
            <div className="md:text-right">
              <div className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
                v{entry.version}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatDate(entry.date)}
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight">{entry.title}</h2>
              <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">
                {entry.summary}
              </p>

              <ul className="mt-4 space-y-3">
                {entry.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_CLASS[change.kind]}`}
                    >
                      {KIND_LABEL[change.kind]}
                    </span>
                    <span className="text-pretty leading-relaxed text-foreground">
                      {change.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </main>
  )
}
