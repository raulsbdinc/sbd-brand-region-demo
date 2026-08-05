"use client"

import useSWR from "swr"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, ShoppingCart, UserRound } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { BrandWordmark } from "@/components/brand-wordmark"
import { CountryFlag } from "@/components/country-flag"
import { SignInDrawer } from "@/components/sign-in-drawer"
import { SITE_BRAND_INFO, SITE_COUNTRY, SITE_NAV } from "@/lib/site"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface RealUserResponse {
  user: { name: string; email: string | null; picture: string | null } | null
}

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<RealUserResponse>)

export function SiteHeader() {
  const { session, logout, authConfigured, signInOpen, openSignIn, closeSignIn } =
    useApp()
  const router = useRouter()

  // When there's no client-side mock session, the user may still hold a REAL
  // Auth0 session from a promoted flow (social / password). Detect it so the
  // header shows the account dropdown instead of the "Sign in" icon.
  const { data: realData } = useSWR(
    authConfigured && !session ? "/api/me" : null,
    fetcher,
    { revalidateOnFocus: true },
  )
  const realUser = !session ? realData?.user ?? null : null

  return (
    <header className="sticky top-0 z-30 bg-[var(--brand-ink)] text-[var(--brand-ink-foreground)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <BrandWordmark onDark />
          <span className="sr-only">{`${SITE_BRAND_INFO.name} ${SITE_COUNTRY.name} storefront home`}</span>
        </Link>

        {/* Market indicator: makes DeWalt France / DeWalt Germany / Craftsman
            France unmistakable at a glance. Driven by SITE_MARKET. */}
        <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-ink-foreground)]/25 px-2.5 py-1 text-xs font-medium text-[var(--brand-ink-foreground)]/80">
          <CountryFlag country={SITE_COUNTRY.id} />
          <span className="font-semibold text-[var(--brand-ink-foreground)]">
            {SITE_COUNTRY.code}
          </span>
          <span className="hidden sm:inline">{SITE_COUNTRY.name}</span>
        </span>

        <nav className="ml-2 hidden items-center gap-4 text-sm font-medium text-[var(--brand-ink-foreground)]/80 md:flex">
          {SITE_NAV.map((item) => (
            <span key={item} className="cursor-default">
              {item}
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            title="Cart (placeholder)"
            className="relative rounded-md p-2 text-[var(--brand-ink-foreground)]/80 transition-colors hover:bg-[var(--brand-ink-foreground)]/10 hover:text-[var(--brand-ink-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <ShoppingCart className="size-5" />
            <span className="sr-only">Cart</span>
          </button>

          {session ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-[var(--brand-ink-foreground)]/90 transition-colors hover:bg-[var(--brand-ink-foreground)]/10 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
                <span className="flex size-7 items-center justify-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--brand-foreground)]">
                  {session.name.charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-sm font-medium sm:inline">
                  {session.name.split(" ")[0]}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col">
                    <span className="text-sm font-semibold">{session.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {session.email}
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/profile")}>
                  My profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/account")}
                  className="text-xs text-muted-foreground focus:text-foreground"
                >
                  Technical view
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/welcome")}>
                  Session details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : realUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-[var(--brand-ink-foreground)]/90 transition-colors hover:bg-[var(--brand-ink-foreground)]/10 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
                {realUser.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={realUser.picture || "/placeholder.svg"}
                    alt=""
                    className="size-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--brand-foreground)]">
                    {realUser.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden text-sm font-medium sm:inline">
                  {realUser.name.split(" ")[0]}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col">
                    <span className="text-sm font-semibold">{realUser.name}</span>
                    {realUser.email ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {realUser.email}
                      </span>
                    ) : null}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/profile")}>
                  My profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => router.push("/account")}
                  className="text-xs text-muted-foreground focus:text-foreground"
                >
                  Technical view
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/welcome")}>
                  Session details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Same canonical logout as everywhere else (see lib/logout.ts):
                    it routes to the SDK-mounted /auth/logout for real sessions. */}
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              onClick={() => openSignIn()}
              title="Sign in"
              className="flex items-center gap-2 rounded-md p-2 text-[var(--brand-ink-foreground)]/80 transition-colors hover:bg-[var(--brand-ink-foreground)]/10 hover:text-[var(--brand-ink-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <UserRound className="size-5" />
              <span className="sr-only">Sign in</span>
            </button>
          )}
        </div>
      </div>

      <SignInDrawer open={signInOpen} onClose={closeSignIn} />
    </header>
  )
}
