"use client"

import { Braces } from "lucide-react"
import { useApp } from "@/components/app-providers"

// Small client island so the server-rendered real /welcome can still offer the
// "Inspect tokens" action. The Token inspector reads the real Auth0 session via
// /api/token-inspector, so opening it here surfaces the genuine decoded tokens.
export function InspectTokensButton() {
  const { setTokenInspectorOpen } = useApp()
  return (
    <button
      type="button"
      onClick={() => setTokenInspectorOpen(true)}
      className="inline-flex h-12 items-center gap-2 rounded-lg bg-secondary px-5 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Braces className="size-5" />
      Inspect tokens
    </button>
  )
}
