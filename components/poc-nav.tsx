"use client"

import { Fragment } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { POC_NAV_GROUPS } from "@/lib/poc-nav"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Header entry that groups all the non-storefront POC pages (evaluation,
 * architecture, the sign-in method pages, docs, changelog) under one menu.
 */
export function PocNav() {
  const router = useRouter()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-sm text-sm font-medium text-[var(--brand-ink-foreground)] underline-offset-4 outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
        POC
        <ChevronDown className="size-4 opacity-80" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {POC_NAV_GROUPS.map((group, index) => (
          <Fragment key={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {group.label}
              </DropdownMenuLabel>
              {group.links.map((link) => (
                <DropdownMenuItem
                  key={link.href}
                  onClick={() => router.push(link.href)}
                >
                  {link.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
