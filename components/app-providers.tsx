"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { BRANDS, COUNTRIES } from "@/lib/brands"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import { buildLogoutUrl } from "@/lib/logout"
import type { BrandId, CountryId, MethodId, Session } from "@/lib/types"

interface AppState {
  /** Active brand skin. Part of the simulated tenant. */
  brand: BrandId
  setBrand: (b: BrandId) => void
  /** Active region. Part of the simulated tenant. */
  country: CountryId
  setCountry: (c: CountryId) => void
  session: Session | null
  setSession: (s: Session | null) => void
  /**
   * Whether the storefront sign-in drawer is open. Lifted here (rather than
   * held locally in SiteHeader) so any signed-out entry point — the hero CTA,
   * an Add-to-cart button, the welcome-page guard — can open the branded drawer
   * instead of navigating to the old /signin route. SiteHeader still renders the
   * drawer itself; these just flip the shared flag.
   */
  signInOpen: boolean
  openSignIn: () => void
  closeSignIn: () => void
  tokenInspectorOpen: boolean
  setTokenInspectorOpen: (o: boolean) => void
  activeFlow: MethodId | null
  startFlow: (m: MethodId) => void
  closeFlow: () => void
  /**
   * Canonical sign-out — the single source of truth (see lib/logout.ts). It
   * always clears the client-side mock session, then, when Auth0 is
   * configured, hands off to the real SDK-mounted /auth/logout route so a real
   * session is fully ended; otherwise it just returns to the storefront home.
   * Every sign-out affordance in the app calls this — including the mock flows.
   */
  logout: () => void
  /**
   * Whether the real Auth0 integration is configured (env vars present),
   * computed on the server and passed down. Flows that have been promoted to
   * real auth (social, password) use this to decide between redirecting to
   * Universal Login and showing a "not configured" state.
   */
  authConfigured: boolean
}

const AppContext = createContext<AppState | null>(null)

export function AppProviders({
  children,
  authConfigured = false,
}: {
  children: ReactNode
  authConfigured?: boolean
}) {
  // Brand + country form this deployment's fixed tenant (e.g. "DeWalt FR").
  // Each Vercel project is pinned to one brand-region via env vars, so these
  // are seeded from SITE_BRAND / SITE_MARKET and never switched at runtime.
  const [brand, setBrand] = useState<BrandId>(SITE_BRAND)
  const [country, setCountry] = useState<CountryId>(SITE_MARKET)
  const [session, setSession] = useState<Session | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [tokenInspectorOpen, setTokenInspectorOpen] = useState(false)
  const [activeFlow, setActiveFlow] = useState<MethodId | null>(null)
  const router = useRouter()

  const logout = useCallback(() => {
    // Always tear down the client-side mock session first, so the showcase and
    // a real session both end up in a clean signed-out state.
    setSession(null)
    setTokenInspectorOpen(false)
    setActiveFlow(null)

    if (authConfigured) {
      // Real Auth0 logout: full navigation (not client routing) so it hits the
      // SDK-mounted /auth/logout route, which clears the server session cookie
      // and ends the IdP session before returning to the app origin.
      window.location.href = buildLogoutUrl()
      return
    }

    // Mock-only showcase (Auth0 not configured): nothing server-side to clear.
    router.push("/")
  }, [authConfigured, router])

  const value = useMemo<AppState>(
    () => ({
      brand,
      setBrand,
      country,
      setCountry,
      session,
      setSession,
      signInOpen,
      openSignIn: () => setSignInOpen(true),
      closeSignIn: () => setSignInOpen(false),
      tokenInspectorOpen,
      setTokenInspectorOpen,
      activeFlow,
      startFlow: (m) => setActiveFlow(m),
      closeFlow: () => setActiveFlow(null),
      logout,
      authConfigured,
    }),
    [brand, country, session, signInOpen, tokenInspectorOpen, activeFlow, logout, authConfigured],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProviders")
  return ctx
}

export function useBrand() {
  const { brand } = useApp()
  return BRANDS[brand]
}

export function useCountry() {
  const { country } = useApp()
  return COUNTRIES[country]
}
