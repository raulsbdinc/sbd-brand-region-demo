"use client"

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Eye, EyeOff, UserRound, X } from "lucide-react"
import { passwordless } from "@auth0/nextjs-auth0/client"
import { useBrand } from "@/components/app-providers"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"
import { looksLikeEmail } from "@/lib/auth-service"

interface SignInDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * Receives the typed email + password. All password-flow auth logic lives in
   * the caller so the drawer stays presentational — the password submit path is
   * behind this one prop. (The passcode path is self-contained below: it talks
   * to the Auth0 SDK's embedded OTP routes and never leaves this panel.)
   */
  onSubmit: (email: string, password: string) => void
}

// Shared styling for the primary CTA so the passcode "Verify" button is styled
// byte-for-byte identically to the password "Sign in" button. Every value is a
// brand token, so both brands theme both buttons through one definition.
const PRIMARY_BUTTON_CLASS =
  "flex h-8 w-full items-center justify-center gap-2 font-[700] [background-color:var(--brand)] [border-radius:var(--brand-button-radius)] [color:var(--brand-button-text)] [font-family:var(--brand-display-font)] [font-size:var(--brand-button-size)] [font-stretch:var(--brand-display-stretch)] [text-transform:var(--brand-display-case)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 disabled:opacity-60"

// Underline-only input shared by every field (email, password, passcode).
const INPUT_CLASS =
  "h-[50px] w-full rounded-none border-b bg-transparent py-[15.5px] text-[16px] outline-none [border-bottom-color:var(--brand-input-border)] [color:var(--brand-label-color)] focus:[border-bottom-color:var(--brand-label-color)]"

/** Mask a local part for display: `jane@x.com` -> `j•••@x.com`. */
function maskEmail(value: string): string {
  const [local, domain] = value.split("@")
  if (!domain) return value
  const head = local.slice(0, 1)
  return `${head}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`
}

// Polaris-style sign-in drawer replicating the live DeWalt / Craftsman panels.
// Every brand difference (display font, case, tracking, heading size, button
// radius, input underline, muted label colour, …) flows in from Brand.vars,
// applied by AppShell on the brand root — there is no per-brand branching here.
export function SignInDrawer({ open, onClose, onSubmit }: SignInDrawerProps) {
  const brand = useBrand()
  const router = useRouter()
  // `mounted` keeps the panel in the DOM through the exit animation; `shown`
  // drives the enter/exit transform + scrim fade.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  // Which body the same drawer is showing. "passcode" is a state of this drawer,
  // not a separate screen — the heading, description and tokens are unchanged.
  const [step, setStep] = useState<"password" | "passcode">("password")
  // Error shown on the password step when requesting a code (e.g. bad email).
  const [requestError, setRequestError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Passcode-step state. `authSession` is an opaque handle from the challenge
  // endpoint — kept only in memory for the in-flight verify, never logged or
  // persisted.
  const [authSession, setAuthSession] = useState("")
  const [otp, setOtp] = useState("")
  const [otpError, setOtpError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const otpInputRef = useRef<HTMLInputElement>(null)
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

  // Reset to the password step whenever the drawer is fully closed, so it never
  // reopens mid-passcode.
  useEffect(() => {
    if (open) return
    setStep("password")
    setRequestError(null)
    setOtp("")
    setOtpError(null)
    setAuthSession("")
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

  // Move focus to the passcode field when that step appears.
  useEffect(() => {
    if (step === "passcode") otpInputRef.current?.focus()
  }, [step])

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

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit(email, password)
  }

  // Send an OTP to the typed email, then swap to the passcode step. Requires a
  // syntactically valid email before touching the network.
  async function sendChallenge(): Promise<boolean> {
    const { authSession: session } = await passwordless.challengeWithEmail({
      email,
      connection: PASSWORD_CONNECTION,
      allowSignup: false,
    })
    setAuthSession(session)
    return Boolean(session)
  }

  async function handleRequestCode() {
    if (!looksLikeEmail(email)) {
      setRequestError("Enter a valid email address first.")
      return
    }
    setRequestError(null)
    setSending(true)
    try {
      await sendChallenge()
      setOtp("")
      setOtpError(null)
      setStep("passcode")
    } catch {
      setRequestError("We couldn't send a passcode. Please try again.")
    } finally {
      setSending(false)
    }
  }

  async function handleResend() {
    setSending(true)
    setOtpError(null)
    try {
      await sendChallenge()
    } catch {
      setOtpError("We couldn't resend the code. Please try again.")
    } finally {
      setSending(false)
    }
  }

  // Exchange the code for a session. loginWithOtp sets the session cookie
  // itself, so success just navigates into the app. A wrong/unknown email only
  // fails here (the challenge always returns a valid-looking session), so we
  // surface both cases with the same message and stay on the passcode step.
  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    const code = otp.trim()
    if (code.length === 0 || verifying) return
    setVerifying(true)
    setOtpError(null)
    try {
      await passwordless.loginWithOtp({ authSession, otp: code })
      router.push("/welcome")
    } catch {
      setOtpError("That code isn't right, or it's expired.")
      setVerifying(false)
    }
  }

  function backToPassword() {
    setStep("password")
    setOtp("")
    setOtpError(null)
  }

  const labelClass =
    "font-sans text-[14px] font-[600] [color:var(--brand-label-color)]"
  const requiredClass = "font-[500] [color:var(--brand-label-muted)]"
  const alertClass =
    "mt-4 font-sans text-[12px] font-[600] leading-[17px] [color:var(--brand)]"

  let body: ReactNode
  if (step === "password") {
    body = (
      <form onSubmit={handlePasswordSubmit} className="mt-6">
        <div className="flex flex-col gap-8">
          {/* Email */}
          <div className="flex flex-col">
            <label htmlFor="sign-in-email" className={labelClass}>
              Email Address
              <span className={requiredClass}>(Required)</span>
            </label>
            <input
              id="sign-in-email"
              type="email"
              autoComplete="username"
              placeholder="Enter email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (requestError) setRequestError(null)
              }}
              className={`${INPUT_CLASS} px-0`}
            />
          </div>

          {/* Password */}
          <div className="flex flex-col">
            <label htmlFor="sign-in-password" className={labelClass}>
              Password
              <span className={requiredClass}>(Required)</span>
            </label>
            <div className="relative">
              <input
                id="sign-in-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${INPUT_CLASS} pl-0 pr-9`}
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

        {/* Secondary action: switch to the embedded passcode path. */}
        <button
          type="button"
          onClick={handleRequestCode}
          disabled={sending}
          className="mt-6 font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline disabled:opacity-60"
        >
          {sending ? "Sending passcode…" : "Email me a one-time passcode instead"}
        </button>

        <div className="mt-6">
          <button
            type="button"
            className="font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline"
          >
            Forgot password?
          </button>
        </div>

        {requestError && (
          <p role="alert" className={alertClass}>
            {requestError}
          </p>
        )}

        <button type="submit" className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}>
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
    )
  } else {
    body = (
      <form onSubmit={handleVerify} className="mt-6">
        <p className="font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {"We sent a one-time passcode to "}
          <span className="font-[600] [color:var(--brand-label-color)]">
            {maskEmail(email)}
          </span>
          {". Enter it below to sign in."}
        </p>

        <div className="mt-6 flex flex-col">
          <label htmlFor="sign-in-otp" className={labelClass}>
            One-time passcode
            <span className={requiredClass}>(Required)</span>
          </label>
          <input
            id="sign-in-otp"
            ref={otpInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Enter 6-digit code"
            value={otp}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              if (otpError) setOtpError(null)
            }}
            className={`${INPUT_CLASS} px-0 tracking-[0.5em]`}
          />
        </div>

        {otpError && (
          <p role="alert" className={alertClass}>
            {otpError}
          </p>
        )}

        <button
          type="submit"
          disabled={verifying || otp.trim().length === 0}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          {verifying ? "Verifying…" : "Verify"}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={sending}
          className="mt-4 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline disabled:opacity-60"
        >
          {sending ? "Resending…" : "Resend code"}
        </button>

        <button
          type="button"
          onClick={backToPassword}
          className="mt-2 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-muted)] outline-none hover:underline focus-visible:underline"
        >
          Back to password sign in
        </button>
      </form>
    )
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

        {body}
      </div>
    </div>
  )
}
