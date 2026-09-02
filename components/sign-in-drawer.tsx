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
import { useBrand } from "@/components/app-providers"
import { GoogleMark } from "@/components/google-mark"
import { GOOGLE_SIGNIN_PATH } from "@/lib/auth0-connections"
import { looksLikeEmail } from "@/lib/auth-service"
import {
  interpretRecoveryResetResponse,
  recoverySuccessMessage,
} from "@/lib/recovery-drawer"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import {
  crossBrandCollisionMessage,
  interpretBrandProofResponse,
  interpretBrandSignupResponse,
  signupUsesBrandFlow,
} from "@/lib/drawer-signup"

interface SignInDrawerProps {
  open: boolean
  /**
   * Which body to land on when the drawer opens. "sign-in" (default) shows the
   * email/password step; "create-account" opens straight on the Create Account
   * step; "recover" opens straight on the inline "forgot password" recovery
   * step. Same drawer either way — this only picks the initial step so the
   * legacy /register and /recover compatibility redirects land correctly.
   */
  initialMode?: "sign-in" | "create-account" | "recover"
  onClose: () => void
}

// Shared styling for the primary CTA so the passcode "Verify" button is styled
// byte-for-byte identically to the password "Sign in" button. Every value is a
// brand token, so both brands theme both buttons through one definition.
const PRIMARY_BUTTON_CLASS =
  "flex h-8 w-full items-center justify-center gap-2 font-[700] [background-color:var(--brand)] [border-radius:var(--brand-button-radius)] [color:var(--brand-button-text)] [font-family:var(--brand-display-font)] [font-size:var(--brand-button-size)] [font-stretch:var(--brand-display-stretch)] [text-transform:var(--brand-display-case)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 disabled:opacity-60"

// Secondary CTA: same size/shape/typography as the primary button but with a
// transparent fill and a hairline border, so "Continue with Google" reads as a
// clearly subordinate alternative rather than a second brand-coloured action.
const SECONDARY_BUTTON_CLASS =
  "flex h-8 w-full items-center justify-center gap-2 border bg-transparent font-[700] [border-color:var(--brand-input-border)] [border-radius:var(--brand-button-radius)] [color:var(--brand-label-color)] [font-family:var(--brand-display-font)] [font-size:var(--brand-button-size)] [font-stretch:var(--brand-display-stretch)] [text-transform:var(--brand-display-case)] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2"

// Underline-only input shared by every field (email, password, passcode).
const INPUT_CLASS =
  "h-[50px] w-full rounded-none border-b bg-transparent py-[15.5px] text-[16px] outline-none [border-bottom-color:var(--brand-input-border)] [color:var(--brand-label-color)] focus:[border-bottom-color:var(--brand-label-color)]"

// The connection's password policy, shown as static helper text on the create
// step and reused verbatim as the weak-password error, so nobody fails this
// live. Mirrors the tenant policy exactly (>=8 chars, >=3 of the 4 char types).
const PASSWORD_REQUIREMENTS =
  "At least 8 characters, including at least 3 of: lower case, upper case, numbers, and special characters."

/** Mask a local part for display: `jane@x.com` -> `j•••@x.com`. */
function maskEmail(value: string): string {
  const [local, domain] = value.split("@")
  if (!domain) return value
  const head = local.slice(0, 1)
  return `${head}${"•".repeat(Math.max(local.length - 1, 1))}@${domain}`
}

// Polaris-style sign-in drawer replicating the live DeWalt / Stanley panels.
// Every brand difference (display font, case, tracking, heading size, button
// radius, input underline, muted label colour, …) flows in from Brand.vars,
// applied by AppShell on the brand root — there is no per-brand branching here.
export function SignInDrawer({ open, initialMode = "sign-in", onClose }: SignInDrawerProps) {
  const brand = useBrand()
  // `mounted` keeps the panel in the DOM through the exit animation; `shown`
  // drives the enter/exit transform + scrim fade.
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  // Inline error + in-flight flag for the embedded password submit, styled
  // exactly like the passcode errors below.
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  // Which body the same drawer is showing. "passcode" and "create" are states
  // of this same drawer, not separate screens — the heading, description and
  // tokens are unchanged.
  const [step, setStep] = useState<
    | "password"
    | "passcode"
    | "create"
    | "brand-proof"
    | "recover-email"
    | "recover-reset"
    | "recover-done"
  >("password")
  // Create-account step state. Reuses the shared `email`/`password`/
  // `showPassword` above so whatever the user typed carries between steps.
  // `createExists` drives the hedged "you may already have an account" block;
  // `createError` is the requirements/weak-password/generic inline error.
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createExists, setCreateExists] = useState(false)
  // Error shown on the password step when requesting a code (e.g. bad email).
  const [requestError, setRequestError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Passcode-step state. The opaque challenge handle is no longer held in the
  // client at all — the server keeps which flow ran, the address and any
  // auth_session in a short-lived httpOnly handoff cookie, so the browser never
  // learns whether the address is a database user or a linked alternate.
  const [otp, setOtp] = useState("")
  const [otpError, setOtpError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  // UK cross-brand (Model 4) proof state. When the SAME email already owns the
  // OTHER UK brand, the drawer stays open and asks for an emailed one-time code
  // to prove ownership before adding THIS brand's credential and linking it to
  // the same canonical account. The customer never learns this is "Model 4" or
  // sees a connection/realm — it's the ordinary Create Account drawer.
  const [brandOtp, setBrandOtp] = useState("")
  const [brandOtpError, setBrandOtpError] = useState<string | null>(null)
  const [brandProofVerifying, setBrandProofVerifying] = useState(false)
  const [brandProofSending, setBrandProofSending] = useState(false)

  // In-drawer "forgot password" recovery state. The whole flow — enter email,
  // receive an emailed one-time code, choose a new password, success — lives in
  // THIS drawer; there is no standalone recovery page. The server resolves which
  // exact credential the email + brand identifies and resets only that one, so
  // the customer never picks a model or sees a connection.
  const [recoverEmail, setRecoverEmail] = useState("")
  const [recoverError, setRecoverError] = useState<string | null>(null)
  const [recoverSending, setRecoverSending] = useState(false)
  const [recoverCode, setRecoverCode] = useState("")
  const [recoverNext, setRecoverNext] = useState("")
  const [recoverConfirm, setRecoverConfirm] = useState("")
  const [recoverResetError, setRecoverResetError] = useState<string | null>(null)
  const [recoverResetting, setRecoverResetting] = useState(false)
  // The masked address a code was sent to, shown on the reset step; the polished
  // customer-facing success line naming exactly which password changed (the
  // proven email for Model 3, the brand for Model 4).
  const [recoverSentTo, setRecoverSentTo] = useState("")
  const [recoverDoneMessage, setRecoverDoneMessage] = useState<string | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const otpInputRef = useRef<HTMLInputElement>(null)
  const brandOtpInputRef = useRef<HTMLInputElement>(null)
  const recoverEmailInputRef = useRef<HTMLInputElement>(null)
  const recoverCodeInputRef = useRef<HTMLInputElement>(null)
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

  // Land the drawer on the correct body each time it OPENS ("create" when the
  // caller asked for create-account mode, otherwise the password step), and
  // reset it to a clean state whenever it is fully closed so it never reopens
  // mid-passcode. Keyed on `open` + `initialMode` so a legacy /register redirect
  // that flips the mode lands straight on Create Account.
  useEffect(() => {
    if (open) {
      setStep(
        initialMode === "create-account"
          ? "create"
          : initialMode === "recover"
            ? "recover-email"
            : "password",
      )
      return
    }
    setStep("password")
    setRequestError(null)
    setPasswordError(null)
    setSigningIn(false)
    setOtp("")
    setOtpError(null)
    setCreating(false)
    setCreateError(null)
    setCreateExists(false)
    setBrandOtp("")
    setBrandOtpError(null)
    setBrandProofVerifying(false)
    setBrandProofSending(false)
    setRecoverEmail("")
    setRecoverError(null)
    setRecoverSending(false)
    setRecoverCode("")
    setRecoverNext("")
    setRecoverConfirm("")
    setRecoverResetError(null)
    setRecoverResetting(false)
    setRecoverSentTo("")
    setRecoverDoneMessage(null)
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
    if (step === "brand-proof") brandOtpInputRef.current?.focus()
    if (step === "recover-email") recoverEmailInputRef.current?.focus()
    if (step === "recover-reset") recoverCodeInputRef.current?.focus()
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

  // Embedded password sign-in: POST to our server route, which does the
  // server-to-server password-realm exchange and sets the __session cookie.
  // On success we navigate into the app; on any failure we show one generic
  // inline error (same style as the passcode errors) and stay in the drawer.
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    if (signingIn) return
    if (!email || !password) {
      setPasswordError("That email or password isn't right.")
      return
    }
    setSigningIn(true)
    setPasswordError(null)
    try {
      const res = await fetch("/api/signin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        setPasswordError("That email or password isn't right.")
        setSigningIn(false)
        return
      }
      // Full document navigation (not router.push): a client-side push keeps
      // this drawer mounted across the route change, so its open + in-flight
      // "Signing in…" state would persist over the profile page until a manual
      // reload. A hard navigation tears the drawer down and re-renders the
      // server components against the __session cookie that was just set, so
      // the profile route paints with the new session on first paint.
      window.location.assign("/profile")
    } catch {
      setPasswordError("That email or password isn't right.")
      setSigningIn(false)
    }
  }

  // Ask the server to send a passcode. The server alone resolves whether this
  // address is a database user or a linked alternate and sends the code the
  // matching way — the response is the same either way, so nothing here (or in
  // the network tab) reveals which flow ran. Throws on a transport error so the
  // callers can show their existing retry copy.
  async function sendChallenge(): Promise<void> {
    const res = await fetch("/api/signin/passcode/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) throw new Error("start failed")
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

  // Exchange the code for a session via the server verify route, which reads the
  // handoff cookie, runs the matching flow, applies the passwordless account
  // guard, and sets the __session cookie itself. Success just navigates into the
  // app. Wrong code, unknown address and unlinked address all come back as the
  // same 401 with one generic message, so we stay on the passcode step and never
  // distinguish them.
  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    const code = otp.trim()
    if (code.length === 0 || verifying) return
    setVerifying(true)
    setOtpError(null)
    try {
      const res = await fetch("/api/signin/passcode/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        setOtpError("That code isn't right, or it's expired.")
        setVerifying(false)
        return
      }
      // Full document navigation, same reasoning as the password path above:
      // tear the drawer down and re-render against the just-set session cookie.
      window.location.assign("/profile")
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

  // Switch to the create-account step, preserving whatever email/password the
  // user has already typed and starting with a clean error state.
  function goToCreate() {
    setStep("create")
    setCreateError(null)
    setCreateExists(false)
  }

  // Return from the create step to the sign-in step with the email preserved,
  // so "Try signing in instead" flows straight into a sign-in attempt.
  function backToSignInFromCreate() {
    setStep("password")
    setCreateError(null)
    setCreateExists(false)
  }

  // After an account is created OR a cross-brand credential is linked, reuse the
  // EXISTING password sign-in route to mint the session (never duplicated) and
  // navigate exactly like the password path. Returns false when the follow-on
  // sign-in didn't take, so the caller can fall back to the sign-in step.
  async function finishWithSignIn(): Promise<boolean> {
    try {
      const signIn = await fetch("/api/signin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (signIn.ok) {
        // Full document navigation, same reasoning as the password path: tears
        // the drawer down and re-renders against the just-set __session cookie.
        window.location.assign("/profile")
        return true
      }
    } catch {
      // fall through
    }
    return false
  }

  // Create the account, then — on success — sign in and navigate. Every failure
  // clears the in-flight flag so no button is left spinning, and the typed
  // email/password are kept.
  //
  // The SAME drawer serves every storefront and the customer NEVER picks an
  // account model. Only the endpoint differs, decided purely from this
  // deployment's market:
  //   • FR/DE  → the shared Model 1/2 signup (/api/signup), unchanged.
  //   • UK     → the per-brand endpoint, which either creates a first-brand
  //              account OR, when the SAME email already owns the other UK brand,
  //              returns "proof-required" so we collect an emailed one-time code
  //              inline and link this brand to the same canonical account.
  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    if (!looksLikeEmail(email)) {
      setCreateError("Enter a valid email address first.")
      return
    }
    if (!password) {
      setCreateError(PASSWORD_REQUIREMENTS)
      return
    }
    setCreating(true)
    setCreateError(null)
    setCreateExists(false)

    if (signupUsesBrandFlow(SITE_MARKET)) {
      await handleBrandCreate()
      return
    }

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json().catch(() => ({}))) as { status?: string }

      if (data.status === "created") {
        if (await finishWithSignIn()) return
        // Follow-on sign-in failed for any reason: drop to the sign-in step with
        // the email preserved and the generic sign-in error.
        setStep("password")
        setPasswordError("That email or password isn't right.")
        setCreating(false)
        return
      }

      if (data.status === "weak_password") {
        setCreateError(PASSWORD_REQUIREMENTS)
        setCreating(false)
        return
      }

      if (data.status === "exists_or_invalid") {
        // Hedged only — never asserts the address is registered.
        setCreateExists(true)
        setCreating(false)
        return
      }

      // status === "error" or anything unexpected.
      setCreateError(
        "Something went wrong creating your account. Please try again.",
      )
      setCreating(false)
    } catch {
      setCreateError(
        "Something went wrong creating your account. Please try again.",
      )
      setCreating(false)
    }
  }

  // UK Create Account submit. Posts the same email/password to the per-brand
  // endpoint and maps the response (via the pure interpreter) to a drawer action.
  async function handleBrandCreate() {
    try {
      const res = await fetch("/api/registration/brand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const action = interpretBrandSignupResponse({ httpStatus: res.status, body: data })

      if (action.kind === "created") {
        if (await finishWithSignIn()) return
        setStep("password")
        setPasswordError("That email or password isn't right.")
        setCreating(false)
        return
      }

      if (action.kind === "proof-required") {
        // The email already owns the OTHER UK brand. Keep the customer in the
        // drawer, move to the ownership-code step, and email a code right away.
        setBrandOtp("")
        setBrandOtpError(null)
        setStep("brand-proof")
        setCreating(false)
        void startBrandProof()
        return
      }

      if (action.kind === "brand-exists") {
        // This brand already has a credential — existing-account / sign-in
        // guidance, never a duplicate.
        setCreateExists(true)
        setCreating(false)
        return
      }

      if (action.kind === "not-configured") {
        setCreateError(
          "Account creation isn\u2019t available on this storefront right now.",
        )
        setCreating(false)
        return
      }

      setCreateError(
        action.message ??
          "Something went wrong creating your account. Please try again.",
      )
      setCreating(false)
    } catch {
      setCreateError(
        "Something went wrong creating your account. Please try again.",
      )
      setCreating(false)
    }
  }

  // Email (or re-email) the one-time ownership code for the UK cross-brand link.
  // The server keeps the target address in a short-lived handoff, so no address
  // is sent from the browser here.
  async function startBrandProof() {
    setBrandProofSending(true)
    setBrandOtpError(null)
    try {
      const res = await fetch("/api/registration/brand/proof/start", {
        method: "POST",
      })
      if (!res.ok) throw new Error("start failed")
    } catch {
      setBrandOtpError("We couldn\u2019t email a code. Please try again.")
    } finally {
      setBrandProofSending(false)
    }
  }

  // Verify the emailed code and, on success, create THIS brand's credential with
  // the password already entered, link it to the same canonical account, then
  // sign in. A wrong/expired code keeps the customer on this step.
  async function handleBrandProofVerify(e: FormEvent) {
    e.preventDefault()
    const code = brandOtp.trim()
    if (code.length === 0 || brandProofVerifying) return
    setBrandProofVerifying(true)
    setBrandOtpError(null)
    try {
      const res = await fetch("/api/registration/brand/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "email-code", newPassword: password, code }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const action = interpretBrandProofResponse({ httpStatus: res.status, body: data })

      if (action.kind === "linked") {
        if (await finishWithSignIn()) return
        setStep("password")
        setPasswordError("That email or password isn\u2019t right.")
        setBrandProofVerifying(false)
        return
      }

      if (action.kind === "bad-code") {
        setBrandOtpError("That code isn\u2019t right, or it\u2019s expired.")
        setBrandProofVerifying(false)
        return
      }

      setBrandOtpError(
        action.kind === "not-configured"
          ? "This isn\u2019t available right now."
          : action.message ?? "We couldn\u2019t verify that. Please try again.",
      )
      setBrandProofVerifying(false)
    } catch {
      setBrandOtpError("We couldn\u2019t verify that. Please try again.")
      setBrandProofVerifying(false)
    }
  }

  // --- In-drawer "forgot password" recovery -------------------------------
  // Enter email -> emailed one-time code -> new password -> success, all in
  // this drawer. The server (POST /api/recovery/start, then /reset) decides
  // which exact credential the email + this brand resolves to and rewrites only
  // that one. The responses stay privacy-neutral: /start never varies with
  // whether an account exists, and /reset names only the requester's own inputs
  // (wrong code, weak password) — everything else is one neutral failure.

  // Open the recovery step, carrying over whatever email was already typed on
  // the sign-in step so the customer doesn't retype it.
  function goToRecover() {
    setRecoverEmail(email)
    setRecoverError(null)
    setRecoverSending(false)
    setRecoverCode("")
    setRecoverNext("")
    setRecoverConfirm("")
    setRecoverResetError(null)
    setRecoverResetting(false)
    setRecoverSentTo("")
    setRecoverDoneMessage(null)
    setStep("recover-email")
  }

  // Leave recovery and return to password sign-in, prefilling the email used.
  function backToSignInFromRecover() {
    if (recoverEmail.trim()) setEmail(recoverEmail.trim())
    setStep("password")
  }

  // STEP 1: email the one-time code. Always advances to the reset step on a
  // non-error transport result — the neutral response is the same whether or
  // not an account exists, so the UI cannot leak existence either.
  async function handleRecoverStart(e: FormEvent) {
    e.preventDefault()
    if (recoverSending) return
    if (!looksLikeEmail(recoverEmail)) {
      setRecoverError("Enter a valid email address.")
      return
    }
    setRecoverError(null)
    setRecoverSending(true)
    try {
      await fetch("/api/recovery/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: recoverEmail.trim() }),
      })
      setRecoverSentTo(recoverEmail.trim())
      setStep("recover-reset")
    } catch {
      setRecoverError("We couldn\u2019t send a code. Please try again.")
    } finally {
      setRecoverSending(false)
    }
  }

  // Re-email the code without leaving the reset step.
  async function handleRecoverResend() {
    setRecoverSending(true)
    setRecoverResetError(null)
    try {
      await fetch("/api/recovery/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: recoverSentTo }),
      })
    } catch {
      setRecoverResetError("We couldn\u2019t resend the code. Please try again.")
    } finally {
      setRecoverSending(false)
    }
  }

  // STEP 2: consume the code (proves ownership) and set the new password on the
  // exact resolved credential. Wrong code / weak password get specific inline
  // messages; anything else is the single neutral failure the server returns.
  async function handleRecoverReset(e: FormEvent) {
    e.preventDefault()
    if (recoverResetting) return
    const code = recoverCode.trim()
    if (code.length === 0) {
      setRecoverResetError("Enter the verification code we emailed you.")
      return
    }
    if (recoverNext.length === 0) {
      setRecoverResetError("Choose a new password.")
      return
    }
    if (recoverNext !== recoverConfirm) {
      setRecoverResetError("Those passwords don\u2019t match.")
      return
    }
    setRecoverResetting(true)
    setRecoverResetError(null)
    try {
      const res = await fetch("/api/recovery/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: recoverSentTo,
          code,
          newPassword: recoverNext,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const action = interpretRecoveryResetResponse({
        httpStatus: res.status,
        body: data,
      })

      if (action.kind === "reset") {
        setRecoverDoneMessage(
          recoverySuccessMessage({
            scope: action.scope,
            email: action.email,
            brandName: action.brandName,
          }),
        )
        setStep("recover-done")
        return
      }
      if (action.kind === "bad-code") {
        setRecoverResetError(
          "That code isn\u2019t right or has expired. Request a new one.",
        )
        return
      }
      if (action.kind === "weak-password") {
        setRecoverResetError(
          "Choose a stronger password. " + PASSWORD_REQUIREMENTS,
        )
        return
      }
      setRecoverResetError(
        "We couldn\u2019t reset your password. Please try again.",
      )
    } catch {
      setRecoverResetError("We couldn\u2019t reset your password. Please try again.")
    } finally {
      setRecoverResetting(false)
    }
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
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (passwordError) setPasswordError(null)
                }}
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
            onClick={goToRecover}
            className="font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline"
          >
            Forgot password?
          </button>
        </div>

        {(passwordError || requestError) && (
          <p role="alert" className={alertClass}>
            {passwordError ?? requestError}
          </p>
        )}

        <button
          type="submit"
          disabled={signingIn}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          <UserRound className="size-4" />
          {signingIn ? "Signing in…" : "Sign in"}
        </button>

        {/* Alternate way in: hand off to Auth0 with the Google connection
            pre-selected. This is a full-page navigation (not fetch) so the
            browser follows Auth0's redirect chain. prompt=login is deliberate —
            see GOOGLE_SIGNIN_PATH — so every brand re-challenges even when a
            Google session already exists, which is the whole point of the demo. */}
        <button
          type="button"
          onClick={() => window.location.assign(GOOGLE_SIGNIN_PATH)}
          className={`mt-3 ${SECONDARY_BUTTON_CLASS}`}
        >
          <GoogleMark className="size-4" />
          Continue with Google
        </button>

        <button
          type="button"
          onClick={goToCreate}
          className="mt-2 flex h-8 w-full items-center justify-center gap-1 bg-transparent font-[700] [color:var(--brand-label-color)] [font-family:var(--brand-display-font)] [font-size:var(--brand-button-size)] [font-stretch:var(--brand-display-stretch)] [text-transform:var(--brand-display-case)] outline-none hover:underline focus-visible:underline"
        >
          Create an account
          <ChevronRight className="size-4" />
        </button>
      </form>
    )
  } else if (step === "passcode") {
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
  } else if (step === "recover-email") {
    // In-drawer "forgot password" — step 1. Enter the email that needs a reset;
    // the server mails a one-time code. Same drawer, same styling as sign-in.
    body = (
      <form onSubmit={handleRecoverStart} className="mt-6">
        <p className="font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {
            "Enter the email for the account you want to reset. We\u2019ll send a one-time verification code to confirm it\u2019s you."
          }
        </p>

        <div className="mt-6 flex flex-col">
          <label htmlFor="recover-email" className={labelClass}>
            Email Address
            <span className={requiredClass}>(Required)</span>
          </label>
          <input
            id="recover-email"
            ref={recoverEmailInputRef}
            type="email"
            autoComplete="username"
            placeholder="Enter email address"
            value={recoverEmail}
            onChange={(e) => {
              setRecoverEmail(e.target.value)
              if (recoverError) setRecoverError(null)
            }}
            className={`${INPUT_CLASS} px-0`}
          />
        </div>

        {recoverError && (
          <p role="alert" className={alertClass}>
            {recoverError}
          </p>
        )}

        <button
          type="submit"
          disabled={recoverSending}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          {recoverSending ? "Sending code…" : "Send verification code"}
        </button>

        <button
          type="button"
          onClick={backToSignInFromRecover}
          className="mt-2 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-muted)] outline-none hover:underline focus-visible:underline"
        >
          Back to sign in
        </button>
      </form>
    )
  } else if (step === "recover-reset") {
    // Recovery step 2. Enter the emailed code and choose a new password. The
    // server consumes the code (proving ownership) and rewrites ONLY the exact
    // credential this email + brand resolves to — no model choice is exposed.
    body = (
      <form onSubmit={handleRecoverReset} className="mt-6">
        <p className="font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {"We sent a one-time code to "}
          <span className="font-[600] [color:var(--brand-label-color)]">
            {maskEmail(recoverSentTo)}
          </span>
          {
            ". Enter it below, then choose a new password for this email\u2019s sign-in."
          }
        </p>

        <div className="mt-6 flex flex-col">
          <label htmlFor="recover-otp" className={labelClass}>
            Verification code
            <span className={requiredClass}>(Required)</span>
          </label>
          <input
            id="recover-otp"
            ref={recoverCodeInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Enter 6-digit code"
            value={recoverCode}
            onChange={(e) => {
              setRecoverCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              if (recoverResetError) setRecoverResetError(null)
            }}
            className={`${INPUT_CLASS} px-0 tracking-[0.5em]`}
          />
        </div>

        <div className="mt-6 flex flex-col">
          <label htmlFor="recover-new" className={labelClass}>
            New password
            <span className={requiredClass}>(Required)</span>
          </label>
          <p className="mt-1 font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-label-muted)]">
            {PASSWORD_REQUIREMENTS}
          </p>
          <div className="relative mt-1">
            <input
              id="recover-new"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Create a new password"
              value={recoverNext}
              onChange={(e) => {
                setRecoverNext(e.target.value)
                if (recoverResetError) setRecoverResetError(null)
              }}
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

        <div className="mt-6 flex flex-col">
          <label htmlFor="recover-confirm" className={labelClass}>
            Confirm new password
            <span className={requiredClass}>(Required)</span>
          </label>
          <input
            id="recover-confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={recoverConfirm}
            onChange={(e) => {
              setRecoverConfirm(e.target.value)
              if (recoverResetError) setRecoverResetError(null)
            }}
            className={`${INPUT_CLASS} pl-0 pr-9`}
          />
        </div>

        {recoverResetError && (
          <p role="alert" className={alertClass}>
            {recoverResetError}
          </p>
        )}

        <button
          type="submit"
          disabled={recoverResetting || recoverCode.trim().length === 0}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          {recoverResetting ? "Updating password…" : "Reset password"}
        </button>

        <button
          type="button"
          onClick={handleRecoverResend}
          disabled={recoverSending}
          className="mt-4 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline disabled:opacity-60"
        >
          {recoverSending ? "Resending…" : "Resend code"}
        </button>

        <button
          type="button"
          onClick={backToSignInFromRecover}
          className="mt-2 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-muted)] outline-none hover:underline focus-visible:underline"
        >
          Back to sign in
        </button>
      </form>
    )
  } else if (step === "recover-done") {
    // Recovery success. The exact credential was reset; return to sign-in.
    body = (
      <div className="mt-6">
        <p className="font-sans text-[13px] font-[600] leading-[19px] [color:var(--brand-label-color)]">
          {recoverDoneMessage ?? "Your password has been updated."}
        </p>
        <p className="mt-2 font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {"Sign in with your new password."}
        </p>

        <button
          type="button"
          onClick={backToSignInFromRecover}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          <UserRound className="size-4" />
          Back to sign in
        </button>
      </div>
    )
  } else if (step === "brand-proof") {
    // UK cross-brand (Model 4) ownership step. The email already has an account
    // on the other UK brand; we prove ownership with an emailed code, then add
    // THIS brand's credential to the same canonical account. Same drawer, same
    // styling as the passcode step — the customer is never told this is "Model 4".
    body = (
      <form onSubmit={handleBrandProofVerify} className="mt-6">
        {crossBrandCollisionMessage(SITE_BRAND) && (
          <p className="font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
            {crossBrandCollisionMessage(SITE_BRAND)}
          </p>
        )}
        <p className="mt-3 font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {"We emailed a one-time code to "}
          <span className="font-[600] [color:var(--brand-label-color)]">
            {maskEmail(email)}
          </span>
          {`. Enter it below to add your ${brand.name} sign-in.`}
        </p>

        <div className="mt-6 flex flex-col">
          <label htmlFor="brand-proof-otp" className={labelClass}>
            One-time code
            <span className={requiredClass}>(Required)</span>
          </label>
          <input
            id="brand-proof-otp"
            ref={brandOtpInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Enter 6-digit code"
            value={brandOtp}
            onChange={(e) => {
              setBrandOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
              if (brandOtpError) setBrandOtpError(null)
            }}
            className={`${INPUT_CLASS} px-0 tracking-[0.5em]`}
          />
        </div>

        {brandOtpError && (
          <p role="alert" className={alertClass}>
            {brandOtpError}
          </p>
        )}

        <button
          type="submit"
          disabled={brandProofVerifying || brandOtp.trim().length === 0}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          {brandProofVerifying ? "Verifying…" : `Verify & add ${brand.name}`}
        </button>

        <button
          type="button"
          onClick={startBrandProof}
          disabled={brandProofSending}
          className="mt-4 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline disabled:opacity-60"
        >
          {brandProofSending ? "Sending…" : "Resend code"}
        </button>

        <button
          type="button"
          onClick={backToSignInFromCreate}
          className="mt-2 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-muted)] outline-none hover:underline focus-visible:underline"
        >
          Back to sign in
        </button>
      </form>
    )
  } else {
    body = (
      <form onSubmit={handleCreateSubmit} className="mt-6">
        <div className="flex flex-col gap-8">
          {/* Email */}
          <div className="flex flex-col">
            <label htmlFor="create-email" className={labelClass}>
              Email Address
              <span className={requiredClass}>(Required)</span>
            </label>
            <input
              id="create-email"
              type="email"
              autoComplete="email"
              placeholder="Enter email address"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (createError) setCreateError(null)
                if (createExists) setCreateExists(false)
              }}
              className={`${INPUT_CLASS} px-0`}
            />
          </div>

          {/* Password, with the policy shown up front as static helper text */}
          <div className="flex flex-col">
            <label htmlFor="create-password" className={labelClass}>
              Password
              <span className={requiredClass}>(Required)</span>
            </label>
            <p className="mt-1 font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-label-muted)]">
              {PASSWORD_REQUIREMENTS}
            </p>
            <div className="relative mt-1">
              <input
                id="create-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (createError) setCreateError(null)
                }}
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

        {createExists ? (
          <div className="mt-6">
            <p role="alert" className={alertClass}>
              {
                "You may already have a Stanley Black & Decker account with this address. One account works across DeWalt, Stanley and our other brands, so try signing in instead."
              }
            </p>
            <button
              type="button"
              onClick={backToSignInFromCreate}
              className="mt-4 font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-color)] outline-none hover:underline focus-visible:underline"
            >
              Try signing in instead
            </button>
          </div>
        ) : (
          createError && (
            <p role="alert" className={alertClass}>
              {createError}
            </p>
          )
        )}

        <button
          type="submit"
          disabled={creating}
          className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        >
          {creating ? "Creating account…" : "Create account"}
        </button>

        <button
          type="button"
          onClick={backToSignInFromCreate}
          className="mt-2 w-full bg-transparent text-center font-sans text-[12px] font-[600] no-underline [color:var(--brand-label-muted)] outline-none hover:underline focus-visible:underline"
        >
          Back to sign in
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
          {step === "create" || step === "brand-proof"
            ? "Create an account"
            : step === "recover-email" ||
                step === "recover-reset" ||
                step === "recover-done"
              ? "Reset your password"
              : "Sign in"}
        </h2>

        <p className="mt-2 font-sans text-[12px] font-[400] leading-[17px] [color:var(--brand-description-color)]">
          {step === "create" || step === "brand-proof"
            ? `Create your ${brand.name} account to manage your profile, register your tools, and track your orders.`
            : step === "recover-email" ||
                step === "recover-reset" ||
                step === "recover-done"
              ? `Reset the password for your ${brand.name} account. We\u2019ll email a one-time code to confirm it\u2019s you.`
              : `Sign in to your ${brand.name} account to manage your profile, register your tools, and track your orders.`}
        </p>

        {/* Static cross-brand notice, shown to every visitor. Deliberately NOT
            a lookup against the typed email: probing whether an address exists
            before authentication is the user-enumeration hole the passcode
            challenge avoids, and we don't reintroduce it here. */}
        <p className="mt-3 rounded-md border border-[var(--brand-input-border)] bg-[var(--brand-surface-muted)] px-3 py-2 font-sans text-[12px] font-[500] leading-[17px] [color:var(--brand-description-color)]">
          {
            "One Stanley Black & Decker account works across DeWalt, Stanley and our other brands. You\u2019ll sign in separately on each site."
          }
        </p>

        {body}
      </div>
    </div>
  )
}
