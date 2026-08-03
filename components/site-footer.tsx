import { SITE_BRAND_INFO, SITE_CONTENT, SITE_COUNTRY } from "@/lib/site"

// Static storefront footer columns. Labels only — this is a demonstration
// storefront, so they don't navigate anywhere (rendered as plain text, the
// same treatment as the header's category nav). The footer's job here is to
// read as the brand's own, not to link out to the POC evaluation pages.
const FOOTER_COLUMNS: { heading: string; items: string[] }[] = [
  { heading: "Products", items: ["Power tools", "Accessories", "Batteries & chargers"] },
  { heading: "Support", items: ["Product registration", "Warranty", "Service centers"] },
  { heading: "Company", items: ["About", "Careers", "Sustainability"] },
]

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          {/* Brand identity + market */}
          <div className="max-w-xs">
            <span className="inline-flex items-center rounded-sm bg-[var(--brand)] px-2 py-1 text-sm font-extrabold tracking-tight text-[var(--brand-foreground)]">
              {SITE_BRAND_INFO.wordmark}
            </span>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {SITE_CONTENT.footerTagline}
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-semibold">
                {SITE_COUNTRY.code}
              </span>
              {SITE_CONTENT.marketLine}
            </p>
          </div>

          {/* Static storefront columns */}
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {col.heading}
                </p>
                <ul className="mt-3 space-y-2">
                  {col.items.map((item) => (
                    <li
                      key={item}
                      className="cursor-default text-sm text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-8 border-t border-border pt-6 text-xs text-muted-foreground">
          {`© ${year} ${SITE_BRAND_INFO.name} · ${SITE_COUNTRY.name}. Demonstration storefront — not a production system.`}
        </div>
      </div>
    </footer>
  )
}
