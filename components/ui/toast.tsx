"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Lightweight, dependency-free toast system for the POC.
// ----------------------------------------------------
// Wrap the app once in <ToastProvider>, then anywhere underneath call
// `const { toast } = useToast()` and fire `toast({ title, description })`.
// A single fixed viewport renders the stack, bottom-right, with enter/exit
// transitions and auto-dismiss. Themed entirely with the design tokens so it
// adapts to the active brand skin.

export type ToastVariant = "default" | "success" | "info" | "destructive"

export interface ToastOptions {
  /** Short headline. */
  title: string
  /** Optional supporting line. */
  description?: ReactNode
  /** Visual treatment + icon. */
  variant?: ToastVariant
  /**
   * Optional monospaced detail rendered in a pill — handy for surfacing things
   * like the active client/app ID when tenancy changes.
   */
  code?: string
  /** Auto-dismiss delay in ms. Defaults to 5000; pass null to make it sticky. */
  duration?: number | null
}

interface ToastRecord extends ToastOptions {
  id: number
}

interface ToastContextValue {
  /** Show a toast. Returns its id (useful for manual dismissal). */
  toast: (options: ToastOptions) => number
  /** Dismiss a specific toast early. */
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    const id = ++counter
    setToasts((current) => [...current, { ...options, id }])
    return id
  }, [])

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within a ToastProvider")
  return ctx
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[]
  onDismiss: (id: number) => void
}) {
  return (
    <div
      // role=region keeps the stack discoverable; each toast announces itself.
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

const VARIANT_ICON = {
  default: Info,
  success: CheckCircle2,
  info: Info,
  destructive: AlertCircle,
} as const

const VARIANT_ICON_CLASS: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-[var(--brand)]",
  info: "text-[var(--brand)]",
  destructive: "text-destructive",
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord
  onDismiss: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const closingRef = useRef(false)

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    // Remove after the exit transition completes.
    window.setTimeout(() => onDismiss(toast.id), 200)
  }, [onDismiss, toast.id])

  useEffect(() => {
    // Trigger the enter transition on the next frame.
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (toast.duration === null) return
    const timer = window.setTimeout(close, toast.duration ?? 5000)
    return () => window.clearTimeout(timer)
  }, [close, toast.duration])

  const Icon = VARIANT_ICON[toast.variant ?? "default"]

  return (
    <div
      role="status"
      aria-live={toast.variant === "destructive" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
        "transition-all duration-200 ease-out",
        open
          ? "translate-y-0 opacity-100 scale-100"
          : "translate-y-2 opacity-0 scale-95",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <Icon
          className={cn("mt-0.5 size-5 shrink-0", VARIANT_ICON_CLASS[toast.variant ?? "default"])}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5 text-balance">{toast.title}</p>
          {toast.description ? (
            <div className="mt-1 text-sm leading-5 text-muted-foreground text-pretty">
              {toast.description}
            </div>
          ) : null}
          {toast.code ? (
            <span className="mt-2 inline-block max-w-full truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {toast.code}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={close}
          className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Dismiss notification</span>
        </button>
      </div>
    </div>
  )
}
