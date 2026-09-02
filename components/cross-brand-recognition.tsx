import { Fragment } from "react"
import { UserCheck } from "lucide-react"
import type { OtherSite } from "@/lib/claims"
import { SITE_COUNTRY } from "@/lib/site"
import type { PasswordModelSummary } from "@/lib/credential-model"
import { crossBrandRecognitionCopy } from "@/lib/cross-brand-copy"

// Cross-brand recognition panel.
//
// Server component only — every value comes from the `sites` prop, which the
// welcome page reads from the already-in-scope Auth0 session user. No client
// JS, no data fetching, no environment variables.
//
// This is the payoff of the whole demo: on a user's FIRST site the list is
// empty and we render nothing, so the executive sees an ordinary welcome. On
// their SECOND brand this panel appears and names the sites they already used
// with this one account — making "one account, one password, one directory
// record" tangible. The absence of a panel on site one is intentional; the
// contrast is the point.

/** Locale-aware short date + time, or null when the timestamp is unusable. */
function formatSignIn(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(SITE_COUNTRY.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

/** A single legible site label, styled so it reads from the back of a room. */
function SiteChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 font-bold text-primary-foreground">
      {label}
    </span>
  )
}

/**
 * Render the labels as chips joined into natural language:
 *   1 → [A]
 *   2 → [A] and [B]
 *   3+ → [A], [B], and [C]
 */
function SiteChips({ sites }: { sites: OtherSite[] }) {
  return (
    <span className="inline">
      {sites.map((site, index) => {
        const isLast = index === sites.length - 1
        const isSecondToLast = index === sites.length - 2
        let separator = ""
        if (!isLast) {
          if (sites.length === 2) separator = " and "
          else if (isSecondToLast) separator = ", and "
          else separator = ", "
        }
        return (
          <Fragment key={site.id || site.label}>
            <SiteChip label={site.label} />
            {separator}
          </Fragment>
        )
      })}
    </span>
  )
}

export function CrossBrandRecognition({
  sites,
  passwordModel,
}: {
  sites: OtherSite[]
  /**
   * The account's ACTUAL password topology, derived server-side from its
   * credential bindings. When omitted or a pure shared-password account, the
   * copy claims "one account, one password, one record" exactly as before
   * (cases 1 & 2). When the account has per-brand (case 4) or per-email (case 3)
   * credentials, the copy stops claiming one password and instead states that
   * each brand/email keeps its own — derived from the bindings, never assumed.
   */
  passwordModel?: PasswordModelSummary
}) {
  // First site ever for this account: deliberately no panel.
  if (sites.length === 0) return null

  const recognitionCopy = crossBrandRecognitionCopy(passwordModel)

  return (
    <section
      aria-labelledby="cross-brand-heading"
      className="mt-8 rounded-2xl border-2 border-primary bg-primary/10 p-6 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <UserCheck className="size-6" />
        </span>
        <div className="min-w-0">
          <h2
            id="cross-brand-heading"
            className="brand-display text-balance text-2xl text-foreground"
          >
            Welcome back to Stanley Black &amp; Decker.
          </h2>
          <p className="mt-2 text-pretty text-base leading-relaxed text-foreground">
            You&apos;ve signed into this same account on{" "}
            <SiteChips sites={sites} />
            {/* Pull the sentence-ending period back over the last chip's px-2
                right padding so the punctuation sits tight against the pill
                instead of floating a pad-width away ("France ." -> "France.").
                The matching right margin re-opens the normal word space before
                the next sentence that the negative left margin would otherwise
                swallow. This lives on the punctuation, not on SiteChip, so the
                chip styling and the join logic are untouched. */}
            <span className="-ml-2 mr-2">.</span>
            {recognitionCopy}
          </p>

          <ul className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
            {sites.map((site) => {
              const when = formatSignIn(site.lastSignIn)
              return (
                <li key={site.id || site.label}>
                  <span className="font-medium text-foreground">{site.label}</span>
                  {when ? <span>{` — last sign-in ${when}`}</span> : null}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}
