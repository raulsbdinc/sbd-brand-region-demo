import { cn } from "@/lib/utils"

/** A checkmark that draws itself, inside a brand-colored disc that glows once. */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "sbd-glow flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground",
        className,
      )}
      role="img"
      aria-label="Success"
    >
      <svg
        className="sbd-check size-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 13l4 4L19 7" />
      </svg>
    </div>
  )
}
