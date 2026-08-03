import Link from "next/link"
import { CURRENT_VERSION } from "@/lib/changelog"
import { POC_NAV_GROUPS } from "@/lib/poc-nav"

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          {/* Identity */}
          <div className="max-w-xs text-sm text-muted-foreground">
            <p className="font-medium text-foreground">SBD Sign-In Experience</p>
            <p className="mt-1">
              A prototype for evaluating a consumer identity platform. Not a
              production system.
            </p>
            <Link
              href="/changelog"
              className="mt-3 inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:bg-muted/70"
              title="Current version"
            >
              v{CURRENT_VERSION}
            </Link>
          </div>

          {/* POC link groups */}
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-8 sm:grid-cols-3"
          >
            {POC_NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {group.label}
                </p>
                <ul className="mt-3 space-y-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="rounded-sm text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  )
}
