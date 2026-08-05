"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  ArrowLeft,
  AtSign,
  Bell,
  Check,
  Copy,
  Fingerprint,
  HelpCircle,
  KeyRound,
  LifeBuoy,
  Loader2,
  Mail,
  MailCheck,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Star,
  Trash2,
  User,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useApp } from "@/components/app-providers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { OtpInput } from "@/components/flows/otp-input"
import { CrossBrandRecognition } from "@/components/cross-brand-recognition"
import { GoogleMark } from "@/components/google-mark"
import { GOOGLE_SIGNIN_PATH } from "@/lib/auth0-connections"
import type { OtherSite } from "@/lib/claims"
import {
  ADDRESS_LOCALITY_ORDER,
  COMMUNICATION_CHANNELS,
  DEFAULT_ADDRESS_COUNTRY,
  DEFAULT_PHONE_PREFIX,
  DEFAULT_PREFERENCES,
  isValidE164,
  normalizePhoneInput,
  type Address,
  type AddressType,
  type CommunicationChannel,
  type Phone as PhoneNumber,
  type SitePreferences,
} from "@/lib/metadata-schema"

// CUSTOMER PROFILE (/profile)
// ===========================
// The projector-facing, customer-grade account page. Everything here is phrased
// the way a shopper reads it on dewalt.com — there is deliberately NO developer
// vocabulary anywhere on screen (no "sub", "claims", "user_metadata",
// "Management API", "Live", or "simulated"). The engineer-facing view with all
// of that detail lives, unchanged, at /account.
//
// Graceful degradation contract (mirrors components/real-account.tsx): when the
// account service can't be reached, the on-screen copy stays plain English and
// tells the person what to do; the technical detail (status code) goes to
// console.warn for a developer with dev tools open, never to the page.

interface CustomerProfileProps {
  user: Record<string, unknown>
  /**
   * Other SBD sites this same account has already signed into, read from the
   * session claims by the server page (extractOtherSites). Drives the
   * cross-brand recognition panel at the top. Empty on a first-ever site — the
   * panel renders nothing in that case, so a first-time user sees no gap.
   */
  sites: OtherSite[]
}

/** Throw on non-OK so SWR populates `error` (not `data`) on failure. */
const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) {
    const err = new Error(`Request failed: ${r.status}`) as Error & {
      status?: number
    }
    err.status = r.status
    throw err
  }
  return r.json()
}

/** Log the technical reason a section couldn't load — never shown on screen. */
function warnUnavailable(section: string, status?: number) {
  console.warn(
    `[SBD profile] "${section}" could not load: the account service returned ${
      status ?? "an unexpected error"
    }.`,
  )
}

const UNAVAILABLE_COPY =
  "We can't show this right now. Please refresh the page or try again in a little while."

// ---------------------------------------------------------------------------
// Small presentational helpers (customer tone — no status tags)
// ---------------------------------------------------------------------------
function ProfileCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          {icon}
        </span>
        <div className="flex-1">
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error"
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        "rounded-lg px-3 py-2 text-xs",
        tone === "error" && "bg-destructive/10 font-medium text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </p>
  )
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "brand"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "brand" && "bg-primary/15 text-foreground",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

// ===========================================================================
// Root
// ===========================================================================
export function CustomerProfile({ user, sites }: CustomerProfileProps) {
  const { logout } = useApp()

  const name =
    (user.name as string) ?? (user.nickname as string) ?? "there"
  const email = (user.email as string | undefined) ?? null
  const picture = user.picture as string | undefined
  const [displayName, setDisplayName] = useState(name)
  const [displayPicture, setDisplayPicture] = useState(picture)

  // Is the account service reachable? Decides whether editable sections are
  // active or gracefully read-only. No developer wording is derived from this.
  const { data: status } = useSWR<{
    authConfigured: boolean
    managementConfigured: boolean
    hardDeleteEnabled: boolean
  }>("/api/account/status", fetcher)
  const live = Boolean(status?.managementConfigured)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {displayPicture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayPicture || "/placeholder.svg"}
            alt=""
            className="size-16 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="flex-1">
          <h1 className="brand-display text-3xl text-foreground">My account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {email
              ? `Signed in as ${email}`
              : "Manage your details, addresses and preferences."}
          </p>
        </div>
      </header>

      {/* Cross-brand recognition — the payoff of the demo, now that /profile is
          where people land after signing in. Sits at the top, below the "My
          account" heading and above "Your details". Renders nothing when the
          account has only ever used this one site, so a first-time user sees no
          gap. Fed by the session claims the server page passed as `sites`. */}
      <CrossBrandRecognition sites={sites} />

      <div className="mt-8 space-y-5">
        <DetailsSection
          live={live}
          initialName={displayName}
          initialPicture={displayPicture}
          fallbackGivenName={(user.given_name as string) ?? ""}
          fallbackFamilyName={(user.family_name as string) ?? ""}
          onNameChange={setDisplayName}
          onPictureChange={setDisplayPicture}
        />

        <EmailSection live={live} primaryEmail={email} />

        <PhoneSection live={live} />

        <AddressesSection live={live} />

        <CommunicationSection live={live} />

        <SignInSection live={live} primaryEmail={email} />

        <DeleteSection live={live} onClosed={() => logout()} />
      </div>

      {/* Low-key link to the engineer-facing view. */}
      <div className="mt-8 border-t border-border pt-4 text-center">
        <Link
          href="/dev-account-details"
          className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Technical view
        </Link>
      </div>
    </main>
  )
}

// ===========================================================================
// Your details
// ===========================================================================
type DetailFields = { given_name: string; family_name: string; name: string; picture: string }

function DetailsSection({
  live,
  initialName,
  initialPicture,
  fallbackGivenName,
  fallbackFamilyName,
  onNameChange,
  onPictureChange,
}: {
  live: boolean
  initialName: string
  initialPicture: string | undefined
  fallbackGivenName: string
  fallbackFamilyName: string
  onNameChange: (name: string) => void
  onPictureChange: (picture: string | undefined) => void
}) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    user: Record<string, unknown>
  }>(live ? "/api/account/profile" : null, fetcher)

  const [saved, setSaved] = useState<DetailFields>({
    given_name: fallbackGivenName,
    family_name: fallbackFamilyName,
    name: initialName,
    picture: initialPicture ?? "",
  })
  const [draft, setDraft] = useState<DetailFields>(saved)
  const [seeded, setSeeded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Seed once the live profile arrives.
  if (live && data?.user && !seeded) {
    const u = data.user
    const next: DetailFields = {
      given_name: (u.given_name as string) ?? "",
      family_name: (u.family_name as string) ?? "",
      name: (u.name as string) ?? initialName,
      picture: (u.picture as string) ?? "",
    }
    setSaved(next)
    setDraft(next)
    setSeeded(true)
  }

  if (error) warnUnavailable("Your details", (error as { status?: number }).status)

  const initials = (saved.name || "?").charAt(0).toUpperCase()

  function startEdit() {
    setDraft(saved)
    setFormError(null)
    setEditing(true)
  }

  async function save() {
    setFormError(null)
    const payload: Record<string, string> = {}
    if (draft.given_name.trim() !== saved.given_name) payload.given_name = draft.given_name.trim()
    if (draft.family_name.trim() !== saved.family_name) payload.family_name = draft.family_name.trim()
    if (draft.name.trim() !== saved.name) payload.name = draft.name.trim()
    if (!draft.name.trim()) {
      setFormError("Please enter a display name.")
      return
    }
    if (Object.keys(payload).length === 0) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(json.error ?? "We couldn't save your changes. Please try again.")
        setBusy(false)
        return
      }
      const u = (json.user ?? {}) as Record<string, unknown>
      const next: DetailFields = {
        given_name: (u.given_name as string) ?? draft.given_name.trim(),
        family_name: (u.family_name as string) ?? draft.family_name.trim(),
        name: (u.name as string) ?? draft.name.trim(),
        picture: (u.picture as string) ?? saved.picture,
      }
      setSaved(next)
      setDraft(next)
      onNameChange(next.name)
      onPictureChange(next.picture || undefined)
      setEditing(false)
      mutate()
    } catch {
      setFormError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProfileCard
      icon={<User className="size-5" />}
      title="Your details"
      description="Your name and how it appears across our stores."
      action={
        live && !editing ? (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            <Pencil className="size-4" />
            Edit
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-center gap-4">
        {saved.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={saved.picture || "/placeholder.svg"} alt="" className="size-12 rounded-full object-cover" />
        ) : (
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{saved.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[saved.given_name, saved.family_name].filter(Boolean).join(" ") || "No name added yet"}
          </p>
        </div>
      </div>

      {editing ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="given_name">First name</Label>
              <Input
                id="given_name"
                value={draft.given_name}
                onChange={(e) => setDraft((p) => ({ ...p, given_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="family_name">Last name</Label>
              <Input
                id="family_name"
                value={draft.family_name}
                onChange={(e) => setDraft((p) => ({ ...p, family_name: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          {formError ? <Note tone="error">{formError}</Note> : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save changes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : !live ? (
        <div className="mt-4">
          <Note>You can view your name here. Editing isn&apos;t available right now.</Note>
        </div>
      ) : null}
    </ProfileCard>
  )
}

// ===========================================================================
// Email addresses — add a REAL alternate sign-in address
// ===========================================================================
// "Add another email address" runs a two-step inline flow inside this card:
// enter the address �� enter the 6-digit passcode we email → the address is
// LINKED onto this account and can be used to sign in. It uses the same six-box
// code input as the sign-in drawer so it reads as one product. There is no
// route change and no developer vocabulary on screen.
interface Identity {
  provider: string
  user_id: string
  profileData?: { email?: string; name?: string }
}

interface AlternateEmail {
  email: string
  user_id: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function EmailSection({ live, primaryEmail }: { live: boolean; primaryEmail: string | null }) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    user: { email?: string; identities?: Identity[] }
  }>(live ? "/api/account/profile" : null, fetcher)

  if (error) warnUnavailable("Email addresses", (error as { status?: number }).status)

  const [adding, setAdding] = useState(false)

  const accountEmail = data?.user?.email ?? primaryEmail
  const alternates: AlternateEmail[] = (data?.user?.identities ?? [])
    .filter((id) => id.provider === "email")
    .map((id) => ({
      email: ((id.profileData?.email as string | undefined) ?? id.user_id) || "",
      user_id: id.user_id,
    }))
    .filter((a) => Boolean(a.email))
    .filter((a) => a.email.toLowerCase() !== (accountEmail ?? "").toLowerCase())

  // Addresses already on the account — used for an instant client-side check so
  // the person gets immediate feedback before we email anything.
  const knownEmails = [
    ...(accountEmail ? [accountEmail.toLowerCase()] : []),
    ...alternates.map((a) => a.email.toLowerCase()),
  ]

  return (
    <ProfileCard
      icon={<Mail className="size-5" />}
      title="Email addresses"
      description="Where we send order updates and account notices. You can add a second address and sign in with either."
    >
      {error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : (
        <ul className="space-y-2">
          {accountEmail ? (
            <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{accountEmail}</span>
              <Badge tone="brand">
                <Star className="size-3" />
                Primary
              </Badge>
            </li>
          ) : (
            <li>
              <Note>No email address on file yet.</Note>
            </li>
          )}
          {alternates.map((a) => (
            <li
              key={a.user_id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm text-foreground">{a.email}</span>
              <div className="flex shrink-0 items-center gap-2">
                <Badge>Signs you in too</Badge>
                <RemoveAlternateButton alternate={a} onRemoved={() => mutate()} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {live && !error ? (
        adding ? (
          <AddEmailFlow
            knownEmails={knownEmails}
            onCancel={() => setAdding(false)}
            onLinked={() => {
              setAdding(false)
              mutate()
            }}
          />
        ) : (
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add another email address
            </Button>
          </div>
        )
      ) : (
        <div className="mt-4">
          <Button variant="outline" size="sm" disabled>
            <Plus className="size-4" />
            Add another email address
          </Button>
        </div>
      )}
    </ProfileCard>
  )
}

/** The inline enter-address → enter-passcode → done flow. */
function AddEmailFlow({
  knownEmails,
  onCancel,
  onLinked,
}: {
  knownEmails: string[]
  onCancel: () => void
  onLinked: () => void
}) {
  const [step, setStep] = useState<"email" | "code" | "done">("email")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [otpKey, setOtpKey] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const normalizedEmail = email.trim().toLowerCase()
  const emailValid = EMAIL_RE.test(normalizedEmail)

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    if (!emailValid) return
    if (knownEmails.includes(normalizedEmail)) {
      setError("That address is already on your account.")
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/account/emails/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? "We couldn't send a code right now. Please try again.")
        setBusy(false)
        return
      }
      setBusy(false)
      setStep("code")
      setCooldown(30)
      setOtpKey((k) => k + 1)
    } catch {
      setError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  async function resend() {
    if (cooldown > 0) return
    setError(null)
    setOtpKey((k) => k + 1)
    setCooldown(30)
    try {
      await fetch("/api/account/emails/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      })
    } catch {
      // A failed resend just means no new code arrived; the person can try again.
    }
  }

  async function verify(entered: string) {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/account/emails/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, code: entered }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? "That code isn't right. Please try again.")
        setOtpKey((k) => k + 1)
        setBusy(false)
        return
      }
      setBusy(false)
      setStep("done")
      setTimeout(() => onLinked(), 1800)
    } catch {
      setError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-email">New email address</Label>
            <Input
              id="add-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll email a 6-digit code to confirm it&apos;s yours. Once confirmed, you
              can sign in with this address too.
            </p>
          </div>
          {error ? <Note tone="error">{error}</Note> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!emailValid || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Send code
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : step === "code" ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Enter the 6-digit code we sent to{" "}
              <span className="text-primary">{normalizedEmail}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              It confirms automatically once all six digits are entered.
            </p>
          </div>

          <OtpInput key={otpKey} disabled={busy} onComplete={verify} />

          {busy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Confirming your address…
            </p>
          ) : null}
          {error ? <Note tone="error">{error}</Note> : null}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resend}
              disabled={cooldown > 0 || busy}
            >
              Resend code
            </Button>
            <span className="text-xs text-muted-foreground">
              {cooldown > 0 ? `Resend available in ${cooldown}s` : "You can resend the code now"}
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep("email")
              setError(null)
            }}
            disabled={busy}
          >
            <ArrowLeft className="size-4" />
            Use a different address
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Address confirmed</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{normalizedEmail}</span> is now on your
              account. You can use it to sign in from now on.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Remove an alternate sign-in email (reuses the identities unlink route). */
function RemoveAlternateButton({
  alternate,
  onRemoved,
}: {
  alternate: AlternateEmail
  onRemoved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/account/identities?provider=email&user_id=${encodeURIComponent(alternate.user_id)}`,
        { method: "DELETE" },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? "We couldn't remove this address. Please try again.")
        setBusy(false)
        return
      }
      setBusy(false)
      setOpen(false)
      onRemoved()
    } catch {
      setError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${alternate.email}`}
            className="text-destructive hover:text-destructive"
          />
        }
      >
        <Trash2 className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this email address?</DialogTitle>
          <DialogDescription>
            {alternate.email} will no longer sign you in to your account. You can add it again at
            any time.
          </DialogDescription>
        </DialogHeader>
        {error ? <Note tone="error">{error}</Note> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep it</DialogClose>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Remove address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Phone numbers — a saved account identifier (staged for text-message sign-in)
// ===========================================================================
// Numbers are stored on the account with add / edit / remove and a default.
// They are presented as an account IDENTIFIER, not an active sign-in method:
// text-message sign-in and verification switch on when a text-message provider
// is connected. The calm explanation lives behind the "?" next to the title.
const EMPTY_PHONE: Omit<PhoneNumber, "id"> = {
  label: "",
  e164: DEFAULT_PHONE_PREFIX,
  is_default: false,
}

// A small "?" button that opens a wide explainer dialog. Shared by the three
// places that explain a method the customer can't act on yet (phone / text
// message, passkeys). One component keeps the copy, the width (sm:max-w-lg) and
// the affordance identical everywhere.
function MethodHelpDialog({
  title,
  ariaLabel,
  children,
}: {
  title: string
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-6 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={ariaLabel}
          />
        }
      >
        <HelpCircle className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {children}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>Got it</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PhoneHelp() {
  return (
    <MethodHelpDialog
      title="About your phone number"
      ariaLabel="About phone numbers and text-message sign-in"
    >
      Text-message sign-in and verification switch on as soon as a text-message
      provider such as Twilio is connected to your account service. Saving and
      managing your number here is already in place. Turning on the provider is
      a configuration change, not new development.
    </MethodHelpDialog>
  )
}

function PhoneSection({ live }: { live: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<{
    configured: boolean
    phones: PhoneNumber[]
  }>(live ? "/api/account/phones" : null, fetcher)

  if (error) warnUnavailable("Phone numbers", (error as { status?: number }).status)

  const phones = data?.phones ?? []

  async function makeDefault(id: string) {
    // Optimistic: reflect the new default immediately, revalidate from server.
    mutate(
      {
        configured: true,
        phones: phones.map((p) => ({ ...p, is_default: p.id === id })),
      },
      { revalidate: false },
    )
    try {
      const res = await fetch("/api/account/phones", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, is_default: true }),
      })
      if (!res.ok) warnUnavailable("Phone numbers", res.status)
    } catch {
      // ignore — the revalidate below restores server truth either way
    } finally {
      mutate()
    }
  }

  return (
    <ProfileCard
      icon={<Phone className="size-5" />}
      title={
        <span className="inline-flex items-center gap-1.5">
          Phone numbers
          <PhoneHelp />
        </span>
      }
      description="Saved to your account so we can reach you about orders and deliveries."
      action={live && !error ? <PhoneDialog mode="add" isFirst={phones.length === 0} onSaved={() => mutate()} /> : undefined}
    >
      {!live || error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your numbers…
        </div>
      ) : phones.length === 0 ? (
        <Note>You haven&apos;t saved a phone number yet.</Note>
      ) : (
        <ul className="space-y-2">
          {phones.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-foreground">{p.e164}</span>
                  {p.is_default ? (
                    <Badge tone="brand">
                      <Check className="size-3" />
                      Default
                    </Badge>
                  ) : null}
                </div>
                {p.label ? <p className="mt-0.5 text-xs text-muted-foreground">{p.label}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!p.is_default ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => makeDefault(p.id)}
                  >
                    Make default
                  </Button>
                ) : null}
                <PhoneDialog mode="edit" phone={p} isFirst={false} onSaved={() => mutate()} />
                <DeletePhoneButton phone={p} onDeleted={() => mutate()} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ProfileCard>
  )
}

function PhoneDialog({
  mode,
  phone,
  isFirst,
  onSaved,
}: {
  mode: "add" | "edit"
  phone?: PhoneNumber
  isFirst: boolean
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Omit<PhoneNumber, "id">>(
    phone ? { label: phone.label, e164: phone.e164, is_default: phone.is_default } : { ...EMPTY_PHONE },
  )
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function reset() {
    setDraft(
      phone
        ? { label: phone.label, e164: phone.e164, is_default: phone.is_default }
        : { ...EMPTY_PHONE },
    )
    setFormError(null)
  }

  async function submit() {
    const e164 = normalizePhoneInput(draft.e164)
    if (!isValidE164(e164)) {
      setFormError(
        "Enter the number in full international format, starting with + and your country code.",
      )
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const res = await fetch("/api/account/phones", {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "add"
            ? { label: draft.label, e164, is_default: draft.is_default }
            : { id: phone?.id, label: draft.label, e164, is_default: draft.is_default },
        ),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(json.error ?? "We couldn't save this number. Please try again.")
        setBusy(false)
        return
      }
      setBusy(false)
      setOpen(false)
      onSaved()
    } catch {
      setFormError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger
        render={
          mode === "add" ? (
            <Button variant="outline" size="sm" />
          ) : (
            <Button variant="ghost" size="sm" aria-label="Edit number" />
          )
        }
      >
        {mode === "add" ? (
          <>
            <Plus className="size-4" />
            Add a phone number
          </>
        ) : (
          <Pencil className="size-4" />
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add a phone number" : "Edit phone number"}</DialogTitle>
          <DialogDescription>
            Enter the number in full international format, starting with + and your country code.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="phone-label">Label</Label>
            <Input
              id="phone-label"
              placeholder="Mobile"
              value={draft.label}
              onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-e164">Phone number</Label>
            <Input
              id="phone-e164"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={`${DEFAULT_PHONE_PREFIX} 6 12 34 56 78`}
              value={draft.e164}
              onChange={(e) => setDraft((p) => ({ ...p, e164: e.target.value }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">Make this my default number</p>
              <p className="text-xs text-muted-foreground">
                The number we&apos;ll try first.
              </p>
            </div>
            <Switch
              checked={isFirst ? true : draft.is_default}
              disabled={isFirst}
              onCheckedChange={(v) => setDraft((p) => ({ ...p, is_default: Boolean(v) }))}
            />
          </div>

          {formError ? <Note tone="error">{formError}</Note> : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeletePhoneButton({ phone, onDeleted }: { phone: PhoneNumber; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch(`/api/account/phones?id=${encodeURIComponent(phone.id)}`, {
        method: "DELETE",
      })
      if (res.ok) onDeleted()
    } catch {
      // A failed delete leaves the number in place; the list simply won't change.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove number"
            className="text-destructive hover:text-destructive"
            disabled={busy}
          />
        }
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this number?</DialogTitle>
          <DialogDescription>
            {phone.e164} will be removed from your account. You can add it again at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep it</DialogClose>
          <DialogClose render={<Button variant="destructive" onClick={remove} />}>
            Remove number
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Addresses (full create / edit / delete)
// ===========================================================================
const EMPTY_ADDRESS: Omit<Address, "id"> = {
  label: "",
  type: "shipping",
  recipient: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postal_code: "",
  country: DEFAULT_ADDRESS_COUNTRY,
  is_default: false,
}

const LOCALITY_LABELS: Record<(typeof ADDRESS_LOCALITY_ORDER)[number], string> = {
  city: "City",
  region: "State / region",
  postal_code: "Postal code",
}

function formatAddressLines(a: Address): string {
  const locality = ADDRESS_LOCALITY_ORDER.map((f) => a[f]).filter(Boolean).join(" ")
  return [a.line1, a.line2, locality, a.country].filter(Boolean).join(", ")
}

function AddressesSection({ live }: { live: boolean }) {
  const { data, error, isLoading, mutate } = useSWR<{
    configured: boolean
    addresses: Address[]
  }>(live ? "/api/account/addresses" : null, fetcher)

  if (error) warnUnavailable("Addresses", (error as { status?: number }).status)

  const addresses = data?.addresses ?? []

  return (
    <ProfileCard
      icon={<MapPin className="size-5" />}
      title="Addresses"
      description="Save the places we deliver to and bill."
      action={
        live && !error ? (
          <AddressDialog mode="add" onSaved={() => mutate()} />
        ) : undefined
      }
    >
      {!live || error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your addresses…
        </div>
      ) : addresses.length === 0 ? (
        <Note>You haven&apos;t saved any addresses yet.</Note>
      ) : (
        <ul className="space-y-3">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{a.label}</span>
                    <Badge>{a.type === "billing" ? "Billing" : "Shipping"}</Badge>
                    {a.is_default ? (
                      <Badge tone="brand">
                        <Check className="size-3" />
                        Default
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-foreground">{a.recipient}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {formatAddressLines(a)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <AddressDialog mode="edit" address={a} onSaved={() => mutate()} />
                  <DeleteAddressButton address={a} onDeleted={() => mutate()} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ProfileCard>
  )
}

function AddressDialog({
  mode,
  address,
  onSaved,
}: {
  mode: "add" | "edit"
  address?: Address
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Omit<Address, "id">>(
    address ? { ...address } : { ...EMPTY_ADDRESS },
  )
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function reset() {
    setDraft(address ? { ...address } : { ...EMPTY_ADDRESS })
    setFormError(null)
  }

  function setField<K extends keyof Omit<Address, "id">>(key: K, value: Omit<Address, "id">[K]) {
    setDraft((p) => ({ ...p, [key]: value }))
  }

  async function submit() {
    setFormError(null)
    if (!draft.recipient.trim() || !draft.line1.trim()) {
      setFormError("Please enter a recipient and a street address.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/addresses", {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "add" ? draft : { ...draft, id: address?.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(json.error ?? "We couldn't save this address. Please try again.")
        setBusy(false)
        return
      }
      setBusy(false)
      setOpen(false)
      onSaved()
    } catch {
      setFormError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger
        render={
          mode === "add" ? (
            <Button variant="outline" size="sm" />
          ) : (
            <Button variant="ghost" size="sm" aria-label="Edit address" />
          )
        }
      >
        {mode === "add" ? (
          <>
            <Plus className="size-4" />
            Add address
          </>
        ) : (
          <Pencil className="size-4" />
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add an address" : "Edit address"}</DialogTitle>
          <DialogDescription>
            Tell us where to send your orders. You can save more than one and pick a default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="addr-label">Label</Label>
              <Input
                id="addr-label"
                placeholder="Home"
                value={draft.label}
                onChange={(e) => setField("label", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-2">
                {(["shipping", "billing"] as AddressType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setField("type", t)}
                    aria-pressed={draft.type === t}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      draft.type === t
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="addr-recipient">Recipient</Label>
            <Input
              id="addr-recipient"
              value={draft.recipient}
              onChange={(e) => setField("recipient", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="addr-line1">Address line 1</Label>
            <Input
              id="addr-line1"
              value={draft.line1}
              onChange={(e) => setField("line1", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-line2">Address line 2 (optional)</Label>
            <Input
              id="addr-line2"
              value={draft.line2}
              onChange={(e) => setField("line2", e.target.value)}
            />
          </div>

          {/* Locality group in the order appropriate to this market. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {ADDRESS_LOCALITY_ORDER.map((field) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`addr-${field}`}>{LOCALITY_LABELS[field]}</Label>
                <Input
                  id={`addr-${field}`}
                  value={draft[field]}
                  onChange={(e) => setField(field, e.target.value)}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="addr-country">Country</Label>
              <Input
                id="addr-country"
                value={draft.country}
                onChange={(e) => setField("country", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">Make this my default</p>
              <p className="text-xs text-muted-foreground capitalize">{draft.type} address</p>
            </div>
            <Switch
              checked={draft.is_default}
              onCheckedChange={(v) => setField("is_default", Boolean(v))}
            />
          </div>

          {formError ? <Note tone="error">{formError}</Note> : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAddressButton({ address, onDeleted }: { address: Address; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch(`/api/account/addresses?id=${encodeURIComponent(address.id)}`, {
        method: "DELETE",
      })
      if (res.ok) onDeleted()
    } catch {
      // A failed delete leaves the address in place; the list simply won't change.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove address"
            className="text-destructive hover:text-destructive"
            disabled={busy}
          />
        }
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this address?</DialogTitle>
          <DialogDescription>
            {address.label
              ? `"${address.label}" will be removed from your saved addresses.`
              : "This address will be removed from your saved addresses."}{" "}
            You can add it again at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep it</DialogClose>
          <DialogClose render={<Button variant="destructive" onClick={remove} />}>
            Remove address
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Communication preferences
// ===========================================================================
function CommunicationSection({ live }: { live: boolean }) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    preferences: SitePreferences
  }>(live ? "/api/account/preferences" : null, fetcher)

  const [busyKey, setBusyKey] = useState<string | null>(null)

  if (error) warnUnavailable("Communication preferences", (error as { status?: number }).status)

  const prefs = data?.preferences ?? DEFAULT_PREFERENCES

  async function patch(next: SitePreferences, key: string) {
    setBusyKey(key)
    // Optimistic — reflect the toggle immediately, revalidate from the server.
    mutate({ configured: true, preferences: next }, { revalidate: false })
    try {
      const res = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        warnUnavailable("Communication preferences", res.status)
        mutate() // roll back to server truth
      } else {
        mutate()
      }
    } catch {
      mutate()
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <ProfileCard
      icon={<Bell className="size-5" />}
      title="Communication preferences"
      description="Choose what we send you and how."
    >
      {!live || error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Marketing emails</p>
              <p className="text-xs text-muted-foreground">
                Product news, promotions and tips.
              </p>
            </div>
            <Switch
              checked={prefs.marketing_opt_in}
              disabled={busyKey === "marketing_opt_in"}
              onCheckedChange={(v) =>
                patch({ ...prefs, marketing_opt_in: Boolean(v) }, "marketing_opt_in")
              }
            />
          </div>

          <Separator />

          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How we reach you
          </p>
          {COMMUNICATION_CHANNELS.map((channel) => (
            <div
              key={channel.value}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{channel.label}</p>
                <p className="text-xs text-muted-foreground">{channel.description}</p>
              </div>
              <Switch
                checked={prefs.communication_prefs[channel.value as CommunicationChannel]}
                disabled={busyKey === channel.value}
                onCheckedChange={(v) =>
                  patch(
                    {
                      ...prefs,
                      communication_prefs: {
                        ...prefs.communication_prefs,
                        [channel.value]: Boolean(v),
                      },
                    },
                    channel.value,
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
    </ProfileCard>
  )
}

// ===========================================================================
// How you sign in
// ===========================================================================
interface MfaFactor {
  id: string
  type: string
  status: string
  name?: string
  createdAt?: string
}

// One row in the "How you sign in" inventory. A single shell keeps all eight
// rows visually consistent: an icon, a name, one plain-English line, an
// optional right-hand slot (a status tag, an action, or the "?" explainer) and
// optional expanded content below (used by the interactive rows).
function MethodRow({
  icon,
  name,
  line,
  right,
  children,
}: {
  icon: React.ReactNode
  name: string
  line: React.ReactNode
  right?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-bold text-foreground">{name}</h3>
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {line}
          </p>
          {children}
        </div>
      </div>
    </li>
  )
}

// A stated fact, not an action — used by the rows that are simply on: email &
// password, email passcode, and any method currently kept on the account.
function ActiveTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
      <Check className="size-3" />
      Active
    </span>
  )
}

// Inline authenticator (TOTP) enrolment. The whole point of part 4: the person
// scans a QR and confirms a code WITHOUT ever leaving this page for Auth0's
// hosted flow. The server generates the secret, verifies the typed code against
// it, and only then registers the factor — so a mis-scan can't leave a broken
// enrolment behind.
function AuthenticatorApp({ live }: { live: boolean }) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    enabled: boolean
    enrollments: MfaFactor[]
  }>(live ? "/api/account/mfa" : null, fetcher)

  if (error) warnUnavailable("Authenticator app", (error as { status?: number }).status)

  const [phase, setPhase] = useState<"idle" | "loading" | "setup" | "done">("idle")
  const [setup, setSetup] = useState<{
    secret: string
    uri: string
    issuer: string
    account: string
  } | null>(null)
  const [otpKey, setOtpKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const authenticators = (data?.enrollments ?? []).filter((e) => e.type === "totp")

  async function start() {
    setEnrollError(null)
    setPhase("loading")
    try {
      const res = await fetch("/api/account/mfa/enroll/start", { method: "POST" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.uri) {
        setEnrollError("We couldn't start setup just now. Please try again.")
        setPhase("idle")
        return
      }
      setSetup({ secret: json.secret, uri: json.uri, issuer: json.issuer, account: json.account })
      setPhase("setup")
    } catch {
      setEnrollError("Something went wrong. Please try again.")
      setPhase("idle")
    }
  }

  async function verify(value: string) {
    setBusy(true)
    setEnrollError(null)
    try {
      const res = await fetch("/api/account/mfa/enroll/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEnrollError(json.error ?? "That code didn't match. Enter the current 6-digit code.")
        setBusy(false)
        setOtpKey((k) => k + 1)
        return
      }
      setBusy(false)
      setSetup(null)
      setPhase("done")
      mutate()
    } catch {
      setEnrollError("Something went wrong. Please try again.")
      setBusy(false)
      setOtpKey((k) => k + 1)
    }
  }

  async function copySecret() {
    if (!setup) return
    try {
      await navigator.clipboard.writeText(setup.secret.replace(/\s/g, ""))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the code is still visible to type by hand */
    }
  }

  async function remove(id: string) {
    setRemoving(id)
    setEnrollError(null)
    try {
      const res = await fetch(`/api/account/mfa?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEnrollError(json.error ?? "We couldn't remove that authenticator. Please try again.")
      }
      mutate()
    } catch {
      setEnrollError("Something went wrong. Please try again.")
    } finally {
      setRemoving(null)
    }
  }

  function cancel() {
    setPhase("idle")
    setSetup(null)
    setEnrollError(null)
    setOtpKey((k) => k + 1)
  }

  if (!live) return null

  return (
    <MethodRow
      icon={<Smartphone className="size-4" />}
      name="Authenticator app"
      line="Use an app like Google Authenticator, 1Password or Authy to generate a sign-in code. Kept on your account and used when an extra check is needed."
      right={authenticators.length > 0 ? <ActiveTag /> : null}
    >
      {authenticators.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {authenticators.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <ShieldCheck className="size-4 text-primary" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {f.name || "Authenticator app"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {f.createdAt
                    ? `Added ${new Date(f.createdAt).toLocaleDateString()}`
                    : "Registered to your account"}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                disabled={removing === f.id}
                onClick={() => remove(f.id)}
              >
                {removing === f.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                <span className="sr-only">Remove authenticator</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {phase === "idle" || phase === "loading" ? (
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={start}
            disabled={phase === "loading"}
          >
            {phase === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {authenticators.length > 0 ? "Add another authenticator" : "Add authenticator app"}
          </Button>
          {enrollError ? (
            <div className="mt-2">
              <Note tone="error">{enrollError}</Note>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "setup" && setup ? (
        <div className="mt-4 space-y-4 rounded-xl border border-border bg-muted/40 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              1. Scan this code with your authenticator app
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              It will be saved as{" "}
              <span className="font-medium text-foreground">{setup.issuer}</span>.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {/* Fixed white background so the QR scans reliably in any theme. */}
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={setup.uri} size={148} level="M" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                Can&apos;t scan? Enter this key in your app instead:
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium tracking-wide text-foreground">
                  {setup.secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copySecret}
                  aria-label="Copy setup key"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium text-foreground">
              2. Enter the 6-digit code from your app
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              It confirms automatically once all six digits are entered.
            </p>
          </div>

          <OtpInput key={otpKey} disabled={busy} onComplete={verify} />

          {busy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Checking the code…
            </p>
          ) : null}
          {enrollError ? <Note tone="error">{enrollError}</Note> : null}

          <div>
            <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Authenticator app added
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Your authenticator app is now kept on your account and used when
                an extra check is needed.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setPhase("idle")}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </MethodRow>
  )
}

// Row 5 — Email security code. An extra email check the account keeps on file.
// Because the address is already verified, adding it is a single call that
// comes back confirmed, so there's no code to type. Add / Remove only.
function EmailSecurityCode({ live }: { live: boolean }) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    enrollments: MfaFactor[]
  }>(live ? "/api/account/mfa" : null, fetcher)

  if (error) warnUnavailable("Email security code", (error as { status?: number }).status)

  const emailMethod = (data?.enrollments ?? []).find((e) => e.type === "email")
  const [busy, setBusy] = useState<null | "add" | "remove">(null)
  const [rowError, setRowError] = useState<string | null>(null)

  async function add() {
    setBusy("add")
    setRowError(null)
    try {
      const res = await fetch("/api/account/mfa/email", { method: "POST" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowError(json.error ?? "We couldn't add that just now. Please try again.")
      }
      await mutate()
    } catch {
      setRowError("Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy("remove")
    setRowError(null)
    try {
      const res = await fetch("/api/account/mfa/email", { method: "DELETE" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowError(json.error ?? "We couldn't remove that just now. Please try again.")
      }
      await mutate()
    } catch {
      setRowError("Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  if (!live) return null

  return (
    <MethodRow
      icon={<MailCheck className="size-4" />}
      name="Email security code"
      line="An extra email check kept on your account and used when we need to confirm it's really you."
      right={emailMethod ? <ActiveTag /> : null}
    >
      <div className="mt-3">
        {emailMethod ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy !== null}
            onClick={remove}
          >
            {busy === "remove" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Remove
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={add}>
            {busy === "add" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add email security code
          </Button>
        )}
        {rowError ? (
          <div className="mt-2">
            <Note tone="error">{rowError}</Note>
          </div>
        ) : null}
      </div>
    </MethodRow>
  )
}

// Row 6 — Backup codes. Regenerating is the ONLY way to see a code: the value
// comes back from the server exactly once, is shown here once in a bordered
// block with a copy button and a clear warning, and is never persisted or
// logged anywhere.
function BackupCodes({ live }: { live: boolean }) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    enrollments: MfaFactor[]
  }>(live ? "/api/account/mfa" : null, fetcher)

  if (error) warnUnavailable("Backup codes", (error as { status?: number }).status)

  const hasCode = (data?.enrollments ?? []).some((e) => e.type === "recovery-code")
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setBusy(true)
    setRowError(null)
    setCode(null)
    try {
      const res = await fetch("/api/account/mfa/recovery-code", { method: "POST" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.recoveryCode) {
        setRowError(json.error ?? "We couldn't generate a code just now. Please try again.")
      } else {
        setCode(json.recoveryCode)
      }
      await mutate()
    } catch {
      setRowError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the code is still visible to copy by hand */
    }
  }

  if (!live) return null

  return (
    <MethodRow
      icon={<LifeBuoy className="size-4" />}
      name="Backup codes"
      line="A single one-time code for getting back in if you lose your other ways to sign in."
      right={hasCode ? <ActiveTag /> : null}
    >
      <div className="mt-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={generate}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <KeyRound className="size-4" />
          )}
          {hasCode ? "Generate a new code" : "Generate a backup code"}
        </Button>
        {rowError ? (
          <div className="mt-2">
            <Note tone="error">{rowError}</Note>
          </div>
        ) : null}
        {code ? (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs font-medium text-foreground">Your backup code</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-semibold tracking-wide text-foreground">
                {code}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copy}
                aria-label="Copy backup code"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Save this somewhere safe now. It won&apos;t be shown again, and
              generating a new one replaces it.
            </p>
          </div>
        ) : null}
      </div>
    </MethodRow>
  )
}

// Row 4 — Google. State comes from the account's linked identities: a
// "google-oauth2" identity means Google is connected. Connecting is a full
// redirect to Auth0 (see GOOGLE_SIGNIN_PATH); a verified-email Google sign-in
// is attached to any existing password account server-side by an Auth0 Action,
// so there is no link endpoint to call from here. Disconnecting is a plain
// server call, guarded so the account can never be left with no way in.
function GoogleSignIn({ live }: { live: boolean }) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    identities: Identity[]
  }>(live ? "/api/account/identities" : null, fetcher)

  if (error) warnUnavailable("Google sign-in", (error as { status?: number }).status)

  const identities = data?.identities ?? []
  const google = identities.find((id) => id.provider === "google-oauth2")
  const connectedLabel =
    google?.profileData?.email ?? google?.profileData?.name ?? google?.user_id
  // Safety net: never let the disconnect leave the account with nothing to sign
  // in with. In practice the password identity is always present, so this only
  // trips in the unlikely case Google is the single remaining identity.
  const isOnlyWayIn = Boolean(google) && identities.length <= 1

  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  async function disconnect() {
    if (!google || isOnlyWayIn) return
    setBusy(true)
    setRowError(null)
    try {
      const res = await fetch(
        `/api/account/identities?provider=google-oauth2&user_id=${encodeURIComponent(google.user_id)}`,
        { method: "DELETE" },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowError(json.error ?? "We couldn't disconnect Google just now. Please try again.")
      }
      await mutate()
    } catch {
      setRowError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!live) return null

  return (
    <MethodRow
      icon={<GoogleMark className="size-4" />}
      name="Google"
      line={
        google
          ? `Connected as ${connectedLabel}.`
          : "Use your Google account to sign in. We'll connect it to this account, so it stays one profile."
      }
      right={google ? <ActiveTag /> : null}
    >
      <div className="mt-3">
        {google ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy || isOnlyWayIn}
            onClick={disconnect}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Disconnect
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.assign(GOOGLE_SIGNIN_PATH)}
          >
            <GoogleMark className="size-4" />
            Connect Google
          </Button>
        )}
        {isOnlyWayIn ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            This is currently your only way to sign in, so it can&apos;t be
            removed. Add your password or another way in first.
          </p>
        ) : null}
        {rowError ? (
          <div className="mt-2">
            <Note tone="error">{rowError}</Note>
          </div>
        ) : null}
      </div>
    </MethodRow>
  )
}

function SignInSection({ live, primaryEmail }: { live: boolean; primaryEmail: string | null }) {
  // We read the profile (not login-methods) for the account email and the
  // count of alternate addresses — the same source the Email addresses section
  // uses, so the two stay in step.
  const { data, error } = useSWR<{
    configured: boolean
    user: { email?: string; identities?: Identity[] }
  }>(live ? "/api/account/profile" : null, fetcher)

  if (error) warnUnavailable("How you sign in", (error as { status?: number }).status)

  const accountEmail = data?.user?.email ?? primaryEmail
  const alternateCount = (data?.user?.identities ?? [])
    .filter((id) => id.provider === "email")
    .map((id) => ((id.profileData?.email as string | undefined) ?? id.user_id) || "")
    .filter(Boolean)
    .filter((e) => e.toLowerCase() !== (accountEmail ?? "").toLowerCase()).length

  return (
    <ProfileCard
      icon={<KeyRound className="size-5" />}
      title="How you sign in"
      description="Every way you can get into your account, and what you can turn on."
    >
      {!live || error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : (
        <ul className="space-y-2">
          {/* 1 — Email and password (the primary way in) */}
          <MethodRow
            icon={<Mail className="size-4" />}
            name="Email and password"
            line={
              accountEmail
                ? `Sign in with ${accountEmail} and your password.`
                : "Sign in with your email address and your password."
            }
            right={<Badge tone="brand">Primary</Badge>}
          />

          {/* 2 — Email passcode (already on every account) */}
          <MethodRow
            icon={<MailCheck className="size-4" />}
            name="Email passcode"
            line="We email you a 6-digit code so you can sign in without a password. Ready to use on this account."
            right={<ActiveTag />}
          />

          {/* 3 — Alternate email addresses (same passcode, any linked address) */}
          <MethodRow
            icon={<AtSign className="size-4" />}
            name="Alternate email addresses"
            line={
              alternateCount > 0
                ? `Any of your ${alternateCount === 1 ? "1 linked address" : `${alternateCount} linked addresses`} can receive that same passcode. Manage them under Email addresses above.`
                : "Any address you link can receive that same passcode. Add one under Email addresses above."
            }
            right={alternateCount > 0 ? <ActiveTag /> : null}
          />

          {/* 4 — Google (linked identity; connect / disconnect) */}
          <GoogleSignIn live={live} />

          {/* 5 — Authenticator app (existing inline enrolment) */}
          <AuthenticatorApp live={live} />

          {/* 6 — Email security code (new) */}
          <EmailSecurityCode live={live} />

          {/* 7 — Backup codes (new) */}
          <BackupCodes live={live} />

          {/* 8 — Passkey (not actionable, explainer only) */}
          <MethodRow
            icon={<Fingerprint className="size-4" />}
            name="Passkey (Face ID, fingerprint or device PIN)"
            line="Sign in with Face ID, a fingerprint or a device PIN, with no password to remember."
            right={
              <MethodHelpDialog title="About passkeys" ariaLabel="About passkeys">
                Passkeys let you sign in with Face ID, a fingerprint or a device
                PIN, with no password to remember. Your account service already
                supports them. Switching them on needs a custom sign-in domain,
                because a passkey is tied to the exact web address that created
                it. That is a domain and configuration step, not new
                development.
              </MethodHelpDialog>
            }
          />

          {/* 9 — Text-message passcode (not actionable, explainer only) */}
          <MethodRow
            icon={<MessageSquare className="size-4" />}
            name="Text-message passcode"
            line="Get a sign-in code by text message. Your numbers are managed in the Phone numbers section above."
            right={
              <MethodHelpDialog
                title="About text-message passcodes"
                ariaLabel="About text-message passcodes"
              >
                Sending a passcode by text switches on as soon as a text-message
                provider such as Twilio is connected to your account service.
                Everything else in this list already works today. Turning on the
                provider is a configuration change, not new development.
              </MethodHelpDialog>
            }
          />
        </ul>
      )}
    </ProfileCard>
  )
}

// ===========================================================================
// Delete account
// ===========================================================================
function DeleteSection({ live, onClosed }: { live: boolean; onClosed: () => void }) {
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function closeAccount() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? "We couldn't close your account. Please try again.")
        setBusy(false)
        return
      }
      setDone(true)
      setBusy(false)
      setTimeout(() => onClosed(), 2500)
    } catch {
      setError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <ProfileCard
      icon={<ShieldAlert className="size-5" />}
      title="Close your account"
      description="Permanently stop using this account."
    >
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm leading-relaxed text-foreground">
          Closing your account signs you out and removes your profile, saved addresses and
          communication preferences. Records we&apos;re legally required to keep — such as
          completed orders and invoices — may be retained for the period the law requires.
        </p>
        {done ? (
          <Note>Your account is being closed. Signing you out…</Note>
        ) : (
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={!live}
                />
              }
            >
              <Trash2 className="size-4" />
              Close my account
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Close your account?</DialogTitle>
                <DialogDescription>
                  This closes your account and signs you out. To confirm, type DELETE below.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="close-confirm">Type DELETE to confirm</Label>
                <Input
                  id="close-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
              {error ? <Note tone="error">{error}</Note> : null}
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" onClick={() => setConfirm("")} />}>
                  Keep my account
                </DialogClose>
                <Button variant="destructive" disabled={confirm !== "DELETE" || busy} onClick={closeAccount}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Close my account
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {!live && !done ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Closing your account isn&apos;t available right now. Please try again shortly.
          </p>
        ) : null}
      </div>
    </ProfileCard>
  )
}
