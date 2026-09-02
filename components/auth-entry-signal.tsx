"use client"

import { useEffect, useRef } from "react"
import { useApp } from "@/components/app-providers"
import { AUTH_QUERY_KEY, RETURN_TO_QUERY_KEY, parseAuthMode } from "@/lib/auth-entry"

/**
 * Root-level consumer for the single-drawer auth entry signal.
 *
 * The storefront's ONLY user-facing sign-in / create-account surface is the
 * standard drawer. The legacy routes (`/signin`, `/sign-in/uk`, `/register/uk`)
 * and the logged-out `/profile` guard are compatibility redirects that bounce to
 * `/?auth=signin|create` (optionally `&returnTo=/profile`). This component reads
 * that signal once on mount, opens the SAME drawer in the requested mode, and
 * then strips the query with `replaceState` so the root URL stays clean and no
 * parallel frontend or model/architecture language is ever exposed.
 *
 * The drawer's own success path hard-navigates to `/profile`, so the standard
 * `returnTo=/profile` case is satisfied by that existing behavior; the query is
 * still consumed/removed here so the URL never lingers with the signal.
 */
export function AuthEntrySignal() {
  const { openSignIn, session } = useApp()
  // Guard so React 18 StrictMode double-invoke (and any re-render) can't reopen
  // the drawer after we've already consumed the signal once.
  const consumed = useRef(false)

  useEffect(() => {
    if (consumed.current) return
    if (typeof window === "undefined") return

    const url = new URL(window.location.href)
    const mode = parseAuthMode(url.searchParams.get(AUTH_QUERY_KEY))
    if (!mode) return

    consumed.current = true

    // Only open for a logged-out visitor; openSignIn() itself also guards on
    // session, but this avoids a needless state flip for signed-in users.
    if (!session) {
      openSignIn(mode)
    }

    // Clean the URL: drop the auth signal (and returnTo) without adding a
    // history entry, so a back button never re-triggers the drawer and the
    // shared/bookmarked URL is just the storefront root.
    url.searchParams.delete(AUTH_QUERY_KEY)
    url.searchParams.delete(RETURN_TO_QUERY_KEY)
    const cleaned =
      url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash
    window.history.replaceState(window.history.state, "", cleaned)
  }, [openSignIn, session])

  return null
}
