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
  // Brand + country form the simulated tenant (e.g. "DeWalt UK"), switched
  // live via the tenant switcher in the header.
  const [brand, setBrand] = useState<BrandId>("dewalt")
  const [country, setCountry] = useState<CountryId>("us")
  const [session, setSession] = useState<Session | null>(null)
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
      tokenInspectorOpen,
      setTokenInspectorOpen,
      activeFlow,
      startFlow: (m) => setActiveFlow(m),
      closeFlow: () => setActiveFlow(null),
      logout,
      authConfigured,
    }),
    [brand, country, session, tokenInspectorOpen, activeFlow, logout, authConfigured],
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
