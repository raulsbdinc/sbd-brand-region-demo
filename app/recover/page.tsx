import type { Metadata } from "next"
import { LockKeyhole, ShieldCheck } from "lucide-react"
import { RecoveryCenter } from "@/components/recovery-center"

export const metadata: Metadata = {
  title: "Account recovery",
  description: "Recover access to your SBD account without exposing account details.",
}

export default function RecoverPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6 sm:py-16">
      <section className="grid w-full overflow-hidden rounded-3xl border border-border bg-card shadow-sm lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="hidden bg-foreground p-10 text-background lg:flex lg:flex-col lg:justify-between">
          <div>
            <span className="flex size-11 items-center justify-center rounded-xl bg-background/10">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-background/60">
              Secure account access
            </p>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight">
              Recovery without disclosure.
            </h2>
            <p className="mt-4 text-pretty text-sm leading-relaxed text-background/70">
              SBD uses neutral responses and one-time links so recovery cannot be
              used to discover customer accounts.
            </p>
          </div>
          <div className="flex items-start gap-3 border-t border-background/15 pt-6">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-background/70">
              Recovery requests do not change access rights or reveal identity
              provider details.
            </p>
          </div>
        </aside>
        <div className="p-6 sm:p-10 lg:p-12">
          <RecoveryCenter />
        </div>
      </section>
    </main>
  )
}
