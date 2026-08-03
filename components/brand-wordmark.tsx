"use client"

import { useBrand } from "@/components/app-providers"
import { cn } from "@/lib/utils"

/**
 * The logo wordmark. Brand switching changes this text and the colors only.
 * Rendered as a bold industrial badge rather than an image so the skin can
 * recolor it live.
 */
export function BrandWordmark({
  className,
  onDark = false,
}: {
  className?: string
  onDark?: boolean
}) {
  const brand = useBrand()
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-1 text-sm font-extrabold tracking-tight tabular-nums",
        onDark
          ? "bg-[var(--brand)] text-[var(--brand-foreground)]"
          : "bg-[var(--brand-ink)] text-[var(--brand-ink-foreground)]",
        className,
      )}
    >
      {brand.wordmark}
    </span>
  )
}
