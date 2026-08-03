"use client"

import type { CSSProperties, ReactNode } from "react"
import { useApp } from "@/components/app-providers"
import { BRANDS } from "@/lib/brands"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DeviceFrame } from "@/components/device-frame"
import { ToastProvider } from "@/components/ui/toast"

export function AppShell({ children }: { children: ReactNode }) {
  const { brand } = useApp()
  const brandVars = BRANDS[brand].vars as CSSProperties

  return (
    <div
      data-brand-root
      data-brand={brand}
      style={brandVars}
      className="flex min-h-screen flex-col bg-[var(--brand-surface)] text-foreground"
    >
      {/* ToastProvider sits inside the brand root so toasts inherit the active
          skin (and var(--brand) resolves), and every surface under the shell —
          including the header's tenant switcher — can call useToast(). */}
      <ToastProvider>
        <SiteHeader />
        <DeviceFrame>{children}</DeviceFrame>
        <SiteFooter />
      </ToastProvider>
    </div>
  )
}
