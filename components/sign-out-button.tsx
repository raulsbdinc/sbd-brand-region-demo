"use client"

import type { ReactNode } from "react"
import { LogOut } from "lucide-react"
import { useApp } from "@/components/app-providers"

// Client island used by server components (/welcome, /live) and any page that
// needs a sign-out affordance. It does not implement logout itself — it simply
// calls the canonical useApp().logout() (see lib/logout.ts), keeping every
// sign-out in the app routed through one source of truth.
export function SignOutButton({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const { logout } = useApp()
  return (
    <button type="button" onClick={() => logout()} className={className}>
      {children ?? (
        <>
          <LogOut className="size-5" />
          Sign out
        </>
      )}
    </button>
  )
}
