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
          ? // Use the dedicated wordmark tokens, not --brand, so the chip works
            // when a brand's bar and accent are the same colour. On Stanley the
            // header bar and accent are both yellow, so the old --brand rule
            // painted a yellow chip on a yellow bar and the wordmark vanished;
            // Stanley's real mark is plain black type on the yellow bar, which
            // is what transparent + #171717 produces.
            "bg-[var(--brand-wordmark-bg)] text-[var(--brand-wordmark-fg)]"
          : "bg-[var(--brand-ink)] text-[var(--brand-ink-foreground)]",
        className,
      )}
    >
      {brand.wordmark}
    </span>
  )
}
