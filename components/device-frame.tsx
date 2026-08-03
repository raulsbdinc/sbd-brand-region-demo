"use client"

import type { ReactNode } from "react"
import { FlowOverlay } from "@/components/flow-overlay"

/**
 * Wraps the storefront experience full width. Auth flow overlays mount within
 * the same surface. Use your browser's responsive tools to test mobile.
 */
export function DeviceFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-1 flex-col">
      {children}
      <FlowOverlay />
    </div>
  )
}
