import { readFile } from "node:fs/promises"
import path from "node:path"
import Link from "next/link"
import { Code2, LineChart, FileWarning, ClipboardList, ListChecks, ShieldCheck } from "lucide-react"
import { Markdown } from "@/components/markdown"

export const dynamic = "force-dynamic"

type DocId = "readme" | "product" | "features" | "evaluation" | "coverage"

const DOCS: Record<
  DocId,
  { label: string; file: string; audience: string; icon: typeof Code2 }
> = {
  readme: {
    label: "Developer guide",
    file: "README.md",
    audience: "For engineers",
    icon: Code2,
  },
  product: {
    label: "Product overview",
    file: "PRODUCT.md",
    audience: "For product & stakeholders",
    icon: LineChart,
  },
  features: {
    label: "Feature backlog & status",
    file: "FEATURE_BACKLOG.md",
    audience: "Full scope, status, Management API + metadata model",
    icon: ClipboardList,
  },
  evaluation: {
    label: "CIAM evaluation",
    file: "CIAM_EVALUATION.md",
    audience: "How we map to the evaluation sheet (see /evaluation for the full page)",
    icon: ListChecks,
  },
  coverage: {
    label: "Auth0 coverage",
    file: "AUTH0_COVERAGE.md",
    audience: "Official documentation and production responsibility boundaries",
    icon: ShieldCheck,
  },
}

async function loadDoc(id: DocId): Promise<string | null> {
  try {
    const filePath = path.join(process.cwd(), DOCS[id].file)
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>
}) {
  const params = await searchParams
  // The Management API and Metadata docs were merged into FEATURE_BACKLOG.md
  // (Parts 3 & 4), so their legacy ?doc= values now resolve to "features".
  const FEATURES_ALIASES = ["features", "management", "metadata", "auth0", "story"]
  const active: DocId =
    params.doc === "product"
      ? "product"
      : params.doc === "evaluation"
        ? "evaluation"
        : params.doc === "coverage"
          ? "coverage"
          : params.doc && FEATURES_ALIASES.includes(params.doc)
            ? "features"
            : "readme"
  const content = await loadDoc(active)

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      {/* Header */}
      <header className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">Documentation</p>
        <h1 className="mt-3 text-balance text-4xl font-extrabold tracking-tight">Project docs</h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          These pages render the project&apos;s README files straight from the repository, so what you read here is
          always in sync with the source.
        </p>
      </header>

      {/* Tabs */}
      <nav aria-label="Documents" className="mt-8 flex flex-wrap gap-2">
        {(Object.keys(DOCS) as DocId[]).map((id) => {
          const doc = DOCS[id]
          const isActive = id === active
          const Icon = doc.icon
          return (
            <Link
              key={id}
              href={`/docs?doc=${id}`}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
            >
              <Icon className="size-4" />
              {doc.label}
            </Link>
          )
        })}
      </nav>

      {/* Active doc */}
      <section className="mt-10 border-t border-border pt-10">
        <p className="text-sm font-medium text-muted-foreground">{DOCS[active].audience}</p>
        <div className="mt-6">
          {content ? (
            <Markdown>{content}</Markdown>
          ) : (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FileWarning className="size-8 text-muted-foreground" />
              <p className="font-medium text-foreground">
                {DOCS[active].file} could not be loaded
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                The file may have been moved or renamed. Check that it still exists at the
                repository root.
              </p>
            </div>
          )}
        </div>
      </section>

      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        Reading{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {DOCS[active].file}
        </code>{" "}
        from the repository root.
      </footer>
    </main>
  )
}
