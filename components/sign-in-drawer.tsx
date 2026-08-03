"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { ChevronRight, Eye, EyeOff, UserRound, X } from "lucide-react"
import { useBrand } from "@/components/app-providers"

interface SignInDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * Receives the typed email + password. All auth logic lives in the caller so
   * the drawer stays presentational — the submit path is behind this one prop.
   */
  onSubmit: (email: string, password: string) => void
}

// Polaris-style sign-in drawer replicating the live DeWalt / Craftsman panels.
// Every brand difference (display font, case, tracking, heading size, button
// radius, input underline, muted label colour, …) flows in from Brand.vars,
// applied by AppShell on the brand root — there is no per-brand branching here.
export function SignInDrawer({ open, onClose, onSubmit }: SignInDrawerProps) {
  const brand = useBrand()
  // `mounted` keeps the panel in the DOM through the exit animation; `shown`
  // drives the enter/exit transform + scrim fade.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Mount + slide animation (0.4s ease-in-out).
  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 400)
    return () => clearTimeout(t)
  }, [open])

  // Lock body scroll while the drawer occupies the DOM.
  useEffect(() => {
    if (!mounted) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [mounted])

  // Move focus into the panel, trap Tab, close on Escape, and restore focus to
  // the trigger on close. Runs once the panel is actually in the DOM.
  useEffect(() => {
    if (!open || !mounted) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current

    const focusable = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : []

    ;(focusable()[0] ?? panel)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== "Tab") return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      previouslyFocused.current?.focus?.()
    }
  }, [open, mounted, onClose])

  if (!mounted) return null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit(email, password)
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {/* Dark scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-[400ms] ease-in-out motion-reduce:transition-none ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Right-side panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-drawer-title"
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 h-full w-full overflow-y-auto bg-[var(--brand-surface)] p-6 shadow-xl outline-none transition-transform duration-[400ms] ease-in-out motion-reduce:transition-none sm:max-w-[34.75rem] xl:max-w-[29.5rem] ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sign in"
          className="absolute right-6 top-6 [color:var(--brand-label-color)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <X className="size-6" />
        </button>

        <h2
          id="sign-in-drawer-title"
          className="pr-10 font-[900] text-black [font-family:var(--brand-display-font)] [font-size:var(--brand-heading-size)] [font-stretch:var(--brand-display-stretch)] [letter-spacing:var(--brand-display-tracking)] [line-height:var(--brand-heading-line)] [text-transform:var(--brand-display-case)]"
        >
          Sign in
        </h2>

        <p className="mt-2 font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {`Sign in to your ${brand.name} account to manage your profile, register your tools, and track your orders.`}
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <div className="flex flex-col gap-8">
            {/* Email */}
            <div className="flex flex-col">
              <label
                htmlFor="sign-in-email"
                className="font-sans text-[14px] font-[600] [color:var(--brand-label-color)]"
              >
                Email Address
                <span className="font-[500] [color:var(--brand-label-muted)]">
                  (Required)
                </span>
              </label>
              <input
                id="sign-in-email"
                type="email"
                autoComplete="username"
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-[50px] w-full rounded-none border-b bg-transparent px-0 py-[15.5px] text-[16px] outline-none [border-bottom-color:var(--brand-input-border)] [color:var(--brand-label-color)] focus:[border-bottom-color:var(--brand-label-color)]"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col">
              <label
                htmlFor="sign-in-password"
                className="font-sans text-[14px] font-[600] [color:var(--brand-label-color)]"
              >
                Password
                <span className="font-[500] [color:var(--brand-label-muted)]">
                  (Required)
                </span>
              </label>
              <div className="relative">
                <input
                  id="sign-in-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-[50px] w-full rounded-none border-b bg-transparent py-[15.5px] pl-0 pr-9 text-[16px] outline-none [border-bottom-color:var(--brand-input-border)] [color:var(--brand-label-color)] focus:[border-bottom-color:var(--brand-label-color)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-1 [color:var(--brand-label-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  {showPassword ? (
                    <EyeOff className="size-5" />
                  ) : (
                    <Eye className="size-5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              className="font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            className="mt-6 flex h-8 w-full items-center justify-center gap-2 font-[700] [background-color:var(--brand)] [border-radius:var(--brand-button-radius)] [color:var(--brand-button-text)] [font-family:var(--brand-display-font)] [font-size:var(--brand-button-size)] [font-stretch:var(--brand-display-stretch)] [text-transform:var(--brand-display-case)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2"
          >
            <UserRound className="size-4" />
            Sign in
          </button>

          <button
            type="button"
            className="mt-2 flex h-8 w-full items-center justify-center gap-1 bg-transparent font-[700] [color:var(--brand-label-color)] [font-family:var(--brand-display-font)] [font-size:var(--brand-button-size)] [font-stretch:var(--brand-display-stretch)] [text-transform:var(--brand-display-case)] outline-none hover:underline focus-visible:underline"
          >
            Create an account
            <ChevronRight className="size-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
