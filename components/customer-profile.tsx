"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import useSWR from "swr"
import {
  ArrowLeft,
  AtSign,
  BadgeCheck,
  Bell,
  Check,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  HelpCircle,
  Info,
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
import type { OtherSite } from "@/lib/claims"
import { summarizePasswordModelFromMethods } from "@/lib/credential-model"
import {
  planEmailPasswordAction,
  emailPasswordActionAriaLabel,
  shouldOfferPostVerificationPassword,
} from "@/lib/email-password-actions"
import {
  planBrandPasswordRows,
  accountCredentialFactsFromMethods,
  resolveProfilePasswordSections,
  planSignInPasswordRows,
  resolveSignInPasswordDisplay,
  type ProfileBrand,
} from "@/lib/brand-password-actions"
import {
  methodRowRightSlotClass,
  passwordRowRightIsWrappingStatus,
} from "@/lib/method-row-layout"
import type { BrandId } from "@/lib/types"
import {
  passwordCredentialLabel,
  passwordCredentialLine,
} from "@/lib/password-credential-labels"
import {
  canSubmitPasswordChange,
  validateNewPassword,
  type PasswordChangeSelector,
} from "@/lib/password-change"
import { newPasswordChecklist } from "@/lib/password-policy"
import { SITE_MARKET } from "@/lib/site"
import { LEGACY_PER_EMAIL_PROFILE_LINE } from "@/lib/uk-feature-flags"
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
  /**
   * Whether THIS storefront runs Model 3 (per-email) — DeWalt UK only, resolved
   * server-side from the effective market + brand. Gates the per-email "Set
   * separate password" actions shown beside each verified email. EU Models 1/2
   * must show ONE shared Account password only, so their linked alternates keep
   * signing in with the same shared password — never a per-email password row.
   */
  perEmailModelAvailable?: boolean
  /**
   * Whether THIS storefront runs Model 4 (per-brand) — Stanley UK only. Gates
   * the dedicated brand-password section (separate DeWalt/Stanley passwords on
   * one canonical account). Never shown on DeWalt UK or EU storefronts.
   */
  perBrandModelAvailable?: boolean
  /** The storefront's own brand (SITE_BRAND), for the Model 4 section. */
  deploymentBrand?: BrandId
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
export function CustomerProfile({
  user,
  sites,
  perEmailModelAvailable = false,
  perBrandModelAvailable = false,
  deploymentBrand,
}: CustomerProfileProps) {
  const { logout } = useApp()

  const name =
    (user.name as string) ?? (user.nickname as string) ?? "there"
  const email = (user.email as string | undefined) ?? null
  const picture = user.picture as string | undefined
  const [displayName, setDisplayName] = useState(name)
  const [displayPicture, setDisplayPicture] = useState(picture)

  // Is the account service reachable? Decides whether editable sections are
  // active or gracefully read-only. No developer wording is derived from this.
  const { data: status, error: statusError } = useSWR<{
    authConfigured: boolean
    managementConfigured: boolean
    hardDeleteEnabled: boolean
  }>("/api/account/status", fetcher)
  const live = Boolean(status?.managementConfigured)
  // Until status resolves, `live` is false — indistinguishable from "service
  // unavailable". Show an honest loading state instead of failure copy.
  const statusLoading = !status && !statusError

  // Derive the account's ACTUAL password topology from the Management-backed
  // login-methods response — NOT from the session user. `app_metadata` (where
  // credential_bindings live) is NOT present in the OIDC session, so reading it
  // off `user` would always read as a single shared password and never surface
  // a case-3/4 credential. The login-methods endpoint is the server result that
  // legitimately exposes each password credential's connection key/brand to the
  // browser. A pure shared-password account (cases 1 & 2) yields the unchanged
  // wording; while loading (or if it can't load) we default to that too.
  const { data: methodsData, error: methodsError } = useSWR<{
    methods?: { kind?: string; connectionKey?: string | null; brand?: string | null }[]
  }>(live ? "/api/account/login-methods" : null, fetcher)
  const passwordModel = summarizePasswordModelFromMethods(
    (methodsData?.methods ?? []) as Parameters<
      typeof summarizePasswordModelFromMethods
    >[0],
  )
  // Demo mode (no management) is only a trustworthy, immediate shared-account
  // default once `/api/account/status` has ACTUALLY loaded and reported that
  // management is not configured. Until status resolves, `status` is undefined
  // and `live` is falsy — which is INDISTINGUISHABLE from genuine demo mode, so
  // keying off `!live` alone asserts the shared default during the very first
  // (SSR/hydration) paint and flashes "one account, one password" onto a Model
  // 4 account before we know anything. Requiring loaded status data keeps the
  // first paint neutral. A status load error is NOT treated as demo mode.
  const demoModeResolved = Boolean(status) && !status?.managementConfigured

  // Whether `passwordModel` reflects the account's real, loaded topology. In
  // resolved demo mode the shared-account default is intentional and immediate.
  // On the live profile the model only becomes trustworthy once the
  // login-methods response lands — until then an empty model summarises as a
  // single shared password, which would wrongly flash "one account, one
  // password" onto a Model 4 (per-brand) account right after activation. Until
  // either condition holds (including the first paint and any hard load error)
  // we keep it unresolved (neutral copy) rather than assert a wrong count.
  const passwordModelResolved = demoModeResolved || Boolean(methodsData)

  // Which discoverable password sections to render is ACCOUNT-aware, not
  // host-only (GLSCM-4834): a Model 4 account (separate DeWalt + Stanley
  // passwords) must show the Brand passwords section on EITHER UK storefront,
  // while a true Model 3 account keeps its per-email actions on DeWalt UK. The
  // host gates only pick the default for an account with no scoped credentials
  // yet. We wait for the login-methods result before trusting the model when a
  // real session exists, so a Model 4 account never flashes the wrong controls;
  // in demo mode (no management) we fall back to the host default immediately.
  const credsResolved =
    demoModeResolved || Boolean(methodsData) || Boolean(methodsError)
  const { showPerEmailActions, showBrandSection, legacyPerEmailAccount } = credsResolved
    ? resolveProfilePasswordSections({
        hostPerEmailModel: perEmailModelAvailable,
        hostPerBrandModel: perBrandModelAvailable,
        facts: accountCredentialFactsFromMethods(methodsData?.methods ?? []),
      })
    : { showPerEmailActions: false, showBrandSection: false }

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
      <CrossBrandRecognition
        sites={sites}
        passwordModel={passwordModel}
        passwordModelResolved={passwordModelResolved}
      />

      {statusLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-8 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
        >
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Loading your account…
        </div>
      ) : (
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

              <EmailSection
                live={live}
                primaryEmail={email}
                modelSelectionAvailable={showPerEmailActions}
              />

        {legacyPerEmailAccount ? (
          <p
            role="note"
            className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground"
          >
            {LEGACY_PER_EMAIL_PROFILE_LINE}
          </p>
        ) : null}

        {showBrandSection && deploymentBrand ? (
          <BrandPasswordSection live={live} deploymentBrand={deploymentBrand} />
        ) : null}

        <PhoneSection live={live} />

        <AddressesSection live={live} />

        <CommunicationSection live={live} />

              <SignInSection
                live={live}
                primaryEmail={email}
                hideBrandPasswordControls={showBrandSection}
                perEmailManaged={showPerEmailActions}
              />

        <DeleteSection live={live} onClosed={() => logout()} />
      </div>
      )}

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
  profileData?: { email?: string; name?: string; email_verified?: boolean }
}

interface AlternateEmail {
  email: string
  user_id: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function EmailSection({
  live,
  primaryEmail,
  modelSelectionAvailable,
}: {
  live: boolean
  primaryEmail: string | null
  modelSelectionAvailable: boolean
}) {
  const { data, error, mutate } = useSWR<{
    configured: boolean
    user: {
      email?: string
      identities?: Identity[]
      app_metadata?: { primary_email?: string }
    }
  }>(live ? "/api/account/profile" : null, fetcher)

  // UK Model 3 only: read the REAL password credentials so each verified email
  // row can offer the right beside-email action — "Change password" when the
  // address already has its own per-email password, or "Set separate password"
  // when it doesn't yet. EU Models 1/2 never fetch this (single Account
  // password), so the extra call is UK-scoped.
  const { data: methodsData, mutate: mutateMethods } = useSWR<{
    configured: boolean
    methods: PasswordMethodView[]
  }>(live && modelSelectionAvailable ? "/api/account/login-methods" : null, fetcher)

  if (error) warnUnavailable("Email addresses", (error as { status?: number }).status)

  const [adding, setAdding] = useState(false)
  const [primaryError, setPrimaryError] = useState<string | null>(null)

  const accountEmail = data?.user?.email ?? primaryEmail
  const alternates: AlternateEmail[] = (data?.user?.identities ?? [])
    .filter((id) => id.provider === "email")
    .map((id) => ({
      email: ((id.profileData?.email as string | undefined) ?? id.user_id) || "",
      user_id: id.user_id,
    }))
    .filter((a) => Boolean(a.email))
    .filter((a) => a.email.toLowerCase() !== (accountEmail ?? "").toLowerCase())

  // A connected Google account's VERIFIED email is a first-class account email:
  // it signs in with the password (login alias) and can be made primary, so it
  // appears here as a "Signs you in too" row — AND still shows in the separate
  // "Google" connection row below. Dedupe against the root email and the
  // "email"-identity rows so it never appears twice in THIS list.
  const seenEmails = new Set<string>([
    ...(accountEmail ? [accountEmail.toLowerCase()] : []),
    ...alternates.map((a) => a.email.toLowerCase()),
  ])
  const googleEmails: AlternateEmail[] = (data?.user?.identities ?? [])
    .filter((id) => id.provider === "google-oauth2")
    .filter((id) => id.profileData?.email_verified !== false)
    .map((id) => ({
      email: (id.profileData?.email as string | undefined)?.toLowerCase() || "",
      user_id: id.user_id,
    }))
    .filter((g) => Boolean(g.email))
    .filter((g) => {
      if (seenEmails.has(g.email)) return false
      seenEmails.add(g.email)
      return true
    })

  // The DISPLAY primary is the designation in app_metadata.primary_email, or —
  // when unset — the account's root email. It is purely a label here: the
  // password and the database identity's email are unchanged. Every OTHER
  // verified email offers "Make primary" and keeps its "Signs you in too" line.
  const designatedPrimary = data?.user?.app_metadata?.primary_email?.toLowerCase()
  const effectivePrimary = designatedPrimary ?? (accountEmail ?? "").toLowerCase()
  const isPrimary = (addr: string) => addr.toLowerCase() === effectivePrimary

  // Addresses already on the account — used for an instant client-side check so
  // the person gets immediate feedback before we email anything.
  const knownEmails = [
    ...(accountEmail ? [accountEmail.toLowerCase()] : []),
    ...alternates.map((a) => a.email.toLowerCase()),
    ...googleEmails.map((g) => g.email.toLowerCase()),
  ]

  // Per-email password credentials keyed by address (UK Model 3). Used both to
  // decide each row's action and to build the exact change target for an email
  // that already has its own password.
  const perEmailByEmail = new Map<string, PasswordMethodView>(
    (methodsData?.methods ?? [])
      .filter((m) => m.kind === "password" && m.connectionKey === "per-email" && m.email)
      .map((m) => [(m.email as string).toLowerCase(), m]),
  )
  const backedPerEmailEmails = [...perEmailByEmail.keys()]

  // Every verified, owned email on the account — the set the pure planner uses
  // to confirm a row is genuinely part of this account before offering actions.
  const allVerifiedEmails = [
    ...(accountEmail ? [accountEmail] : []),
    ...alternates.map((a) => a.email),
    ...googleEmails.map((g) => g.email),
  ]

  // Refresh both the profile and the credential list after a password action so
  // a row flips from "Set separate password" to "Change password" in place.
  function refreshEmailsAndMethods() {
    void mutate()
    void mutateMethods()
  }

  return (
    <ProfileCard
      icon={<Mail className="size-5" />}
      title="Email addresses"
      description="Where we send order updates and account notices. You can add a second address and sign in with either."
    >
      {error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : live && !data ? (
        <Note>Loading…</Note>
      ) : (
        <ul className="space-y-2">
          {accountEmail ? (
            <li className="rounded-xl border border-border bg-background px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`min-w-0 truncate text-sm text-foreground ${isPrimary(accountEmail) ? "font-medium" : ""}`}
                >
                  {accountEmail}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {isPrimary(accountEmail) ? (
                    <Badge tone="brand">
                      <Star className="size-3" />
                      Primary
                    </Badge>
                  ) : (
                    <>
                      <Badge>Signs you in too</Badge>
                      <MakePrimaryButton
                        email={accountEmail}
                        onDone={() => {
                          setPrimaryError(null)
                          mutate()
                        }}
                        onError={(m) => setPrimaryError(m || null)}
                      />
                    </>
                  )}
                </div>
              </div>
              <EmailPasswordActionRow
                email={accountEmail}
                primaryEmail={accountEmail}
                live={live}
                perEmailActivationAvailable={modelSelectionAvailable}
                verifiedEmails={allVerifiedEmails}
                backedPerEmailEmails={backedPerEmailEmails}
                method={perEmailByEmail.get(accountEmail.toLowerCase())}
                onDone={refreshEmailsAndMethods}
              />
            </li>
          ) : (
            <li>
              <Note>No email address on file yet.</Note>
            </li>
          )}
          {alternates.map((a) => (
            <li
              key={a.user_id}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`min-w-0 truncate text-sm text-foreground ${isPrimary(a.email) ? "font-medium" : ""}`}
                >
                  {a.email}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {isPrimary(a.email) ? (
                    <Badge tone="brand">
                      <Star className="size-3" />
                      Primary
                    </Badge>
                  ) : (
                    <>
                      <Badge>Signs you in too</Badge>
                      <MakePrimaryButton
                        email={a.email}
                        onDone={() => {
                          setPrimaryError(null)
                          mutate()
                        }}
                        onError={(m) => setPrimaryError(m || null)}
                      />
                    </>
                  )}
                  <RemoveAlternateButton alternate={a} onRemoved={() => mutate()} />
                </div>
              </div>
              <EmailPasswordActionRow
                email={a.email}
                primaryEmail={accountEmail}
                live={live}
                perEmailActivationAvailable={modelSelectionAvailable}
                verifiedEmails={allVerifiedEmails}
                backedPerEmailEmails={backedPerEmailEmails}
                method={perEmailByEmail.get(a.email.toLowerCase())}
                onDone={refreshEmailsAndMethods}
              />
            </li>
          ))}
          {googleEmails.map((g) => (
            <li
              key={g.user_id}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`min-w-0 truncate text-sm text-foreground ${isPrimary(g.email) ? "font-medium" : ""}`}
                >
                  {g.email}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {isPrimary(g.email) ? (
                    <Badge tone="brand">
                      <Star className="size-3" />
                      Primary
                    </Badge>
                  ) : (
                    <>
                      <Badge>Signs you in too</Badge>
                      <MakePrimaryButton
                        email={g.email}
                        onDone={() => {
                          setPrimaryError(null)
                          mutate()
                        }}
                        onError={(m) => setPrimaryError(m || null)}
                      />
                    </>
                  )}
                </div>
              </div>
              <EmailPasswordActionRow
                email={g.email}
                primaryEmail={accountEmail}
                live={live}
                perEmailActivationAvailable={modelSelectionAvailable}
                verifiedEmails={allVerifiedEmails}
                backedPerEmailEmails={backedPerEmailEmails}
                method={perEmailByEmail.get(g.email.toLowerCase())}
                onDone={refreshEmailsAndMethods}
              />
            </li>
          ))}
        </ul>
      )}

      {primaryError ? (
        <div className="mt-2">
          <Note tone="error">{primaryError}</Note>
        </div>
      ) : null}

      {live && !error ? (
        adding ? (
          <AddEmailFlow
            knownEmails={knownEmails}
            primaryEmail={accountEmail}
            perEmailActivationAvailable={modelSelectionAvailable}
            onCancel={() => setAdding(false)}
            onLinked={() => {
              setAdding(false)
              refreshEmailsAndMethods()
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

// The address-specific password action shown directly beneath each verified
// email in the Email addresses section (GLSCM-4834). It renders inside the
// existing email <li> as a divided sub-row — NOT a nested card — so the control
// sits right where the customer is looking. The pure planner decides the single
// action; the label + dialog follow from it:
//   • "set-separate" → "Set separate password" (existing per-email activation)
//   • "change"       → "Change password" (existing inline change dialog)
//   • "none"         → nothing (EU Models 1/2, or the primary before activation)
// Both dialogs reuse the existing endpoints/forms — no redirect, no standalone
// sign-in/recover experience.
function EmailPasswordActionRow({
  email,
  primaryEmail,
  live,
  perEmailActivationAvailable,
  verifiedEmails,
  backedPerEmailEmails,
  method,
  onDone,
}: {
  email: string
  primaryEmail: string | null
  live: boolean
  perEmailActivationAvailable: boolean
  verifiedEmails: string[]
  backedPerEmailEmails: string[]
  method?: PasswordMethodView
  onDone: () => void
}) {
  const kind = planEmailPasswordAction({
    email,
    primaryEmail,
    perEmailActivationAvailable,
    verifiedEmails,
    backedPerEmailEmails,
  })

  if (kind === "none") return null

  if (kind === "change") {
    // Only offer an inline change when we can safely target the credential from
    // the browser (a per-email binding id). Otherwise show nothing here — the
    // credential is still changeable from the "How you sign in" list.
    const target = method ? changeTargetForMethod(method) : null
    if (!target) return null
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          This email has its own password.
        </span>
        <ChangePasswordDialog
          target={target}
          live={live}
          onChanged={onDone}
          triggerAriaLabel={emailPasswordActionAriaLabel("change", email)}
        />
      </div>
    )
  }

  // set-separate
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <span className="min-w-0 text-xs text-muted-foreground">
        Give this email its own password so it signs in independently.
      </span>
      <ActivatePerEmailDialog
        secondaryEmail={email}
        primaryEmail={primaryEmail}
        triggerLabel="Set separate password"
        triggerAriaLabel={emailPasswordActionAriaLabel("set-separate", email)}
        onActivated={onDone}
      />
    </div>
  )
}

// ===========================================================================
// Brand passwords (Model 4 — Stanley UK only)
// ===========================================================================
// GLSCM-4834 (follow-up): password management must be equally discoverable on
// the per-brand UK storefront. Where DeWalt UK (Model 3) shows a separate
// password per EMAIL beside each address, Stanley UK (Model 4) keeps ONE
// canonical account with a separate password per BRAND. This dedicated section
// surfaces those brand passwords directly in /profile — the deployment brand
// first — so the customer never hunts through a generic credentials list. The
// pure planner decides which rows appear (set vs change); each row states the
// exact brand and scope BEFORE the customer opens a dialog. Both dialogs reuse
// the existing endpoints (this-brand provisioning + password-change) with no
// redirect and no standalone route. Rendered only when perBrandModelAvailable,
// so DeWalt UK and EU storefronts never see it.
function BrandPasswordSection({
  live,
  deploymentBrand,
}: {
  live: boolean
  deploymentBrand: BrandId
}) {
  // The REAL brand credentials — one reset binding per credential — decide the
  // change targets and which brands already have a password.
  const { data: methodsData, error: methodsError, mutate: mutateMethods } = useSWR<{
    configured: boolean
    methods: PasswordMethodView[]
  }>(live ? "/api/account/login-methods" : null, fetcher, {
    onError: (err) => warnUnavailable("Brand passwords", (err as { status?: number })?.status),
  })

  // Whether THIS storefront's brand password can be provisioned right now.
  const { data: availData, mutate: mutateAvail } = useSWR<{
    configured: boolean
    availability?: { thisBrand?: { available?: boolean } }
  }>(live ? "/api/account/passwords" : null, fetcher)

  const brandMethods = new Map<ProfileBrand, PasswordMethodView>()
  for (const m of methodsData?.methods ?? []) {
    if (m.kind === "password" && (m.connectionKey === "dewalt" || m.connectionKey === "stanley")) {
      brandMethods.set(m.connectionKey, m)
    }
  }

  const rows = planBrandPasswordRows({
    perBrandModelAvailable: true,
    deploymentBrand,
    existingBrandCredentials: [...brandMethods.keys()],
    thisBrandProvisionable: Boolean(availData?.availability?.thisBrand?.available),
  })

  function refresh() {
    void mutateMethods()
    void mutateAvail()
  }

  return (
    <ProfileCard
      icon={<KeyRound className="size-5" />}
      title="Brand passwords"
      description="Your account uses a separate password for each brand. Set or change the one you need — the other brand's password is never affected."
    >
      <p
        role="note"
        aria-label="About this section"
        className="mb-3 flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>This section is shown in the POC so we can test separate brand passwords.</span>
      </p>
      {methodsError ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : !live ? (
        <Note>Sign in to manage your brand passwords.</Note>
      ) : !methodsData ? (
        <Note>Loading…</Note>
      ) : rows.length === 0 ? (
        <Note>No brand password is available to manage on this account yet.</Note>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const method = brandMethods.get(row.brand)
            const changeTarget =
              row.kind === "change" && method ? changeTargetForMethod(method) : null
            return (
              <li
                key={row.brand}
                className="rounded-xl border border-border bg-background px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {row.brandName} password
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        {row.brandName}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{row.scopeLine}</p>
                  </div>
                  <div className="shrink-0">
                    {row.kind === "change" ? (
                      changeTarget ? (
                        <ChangePasswordDialog
                          target={changeTarget}
                          live={live}
                          onChanged={refresh}
                          triggerLabel={`Change ${row.brandName} password`}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Managed with your account
                        </span>
                      )
                    ) : (
                      <SetBrandPasswordDialog
                        brand={row.brand}
                        brandName={row.brandName}
                        live={live}
                        onDone={refresh}
                      />
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </ProfileCard>
  )
}

// In-site dialog that PROVISIONS this storefront's brand password (Model 4).
// It names the exact brand and scope up front, collects a new password, and
// posts to the existing this-brand provisioning endpoint — no current password
// (the session authenticates the customer), no redirect. Sensitive fields are
// cleared on close and success.
function SetBrandPasswordDialog({
  brand,
  brandName,
  live,
  onDone,
}: {
  brand: ProfileBrand
  brandName: string
  live: boolean
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const policy = validateNewPassword(next, SITE_MARKET)
  const confirmMismatch = confirm.length > 0 && confirm !== next
  const canSubmit = !busy && policy.ok && confirm === next && confirm.length > 0

  function wipe() {
    setNext("")
    setConfirm("")
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      wipe()
      setError(null)
      setDone(null)
      setBusy(false)
    }
  }

  async function submit() {
    setError(null)
    if (!canSubmit) return
    if (!live) {
      setDone(
        `In production this securely sets your ${brandName} password. This demo doesn't change real credentials.`,
      )
      wipe()
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/passwords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "this-brand", password: next }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        credential?: { label?: string }
      }
      if (!res.ok || !json.credential) {
        setError(json.error ?? "We couldn't set that password. Please try again.")
        return
      }
      wipe()
      setDone(`${json.credential?.label ?? `${brandName} password`} is set.`)
      onDone?.()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus className="size-4" />
            Set {brandName} password
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Set {brandName} password</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {brandName}
            </span>
          </DialogTitle>
          <DialogDescription>
            {`Choose a password for signing in to ${brandName} sites. It applies only to your ${brandName} sign-in — your other brand password is not affected.`}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <Note>
              <span className="inline-flex items-center gap-2">
                <BadgeCheck className="size-4 text-primary" />
                {done}
              </span>
            </Note>
            <DialogFooter>
              <DialogClose render={<Button>Done</Button>} />
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="space-y-4"
          >
            <PasswordField
              id={`set-brand-new-${brand}`}
              label={`New ${brandName} password`}
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              invalid={next.length > 0 && !policy.ok}
              describedBy={`set-brand-policy-${brand}`}
            />
            <ul id={`set-brand-policy-${brand}`} className="space-y-1 text-xs text-muted-foreground">
              {newPasswordChecklist(next, SITE_MARKET).map((r) => (
                <li key={r.text} className="flex items-center gap-1.5">
                  <Check
                    className={cn("size-3.5 shrink-0", r.ok ? "text-primary" : "text-muted-foreground/40")}
                  />
                  <span className={cn(r.ok && "text-foreground")}>{r.text}</span>
                </li>
              ))}
            </ul>
            <PasswordField
              id={`set-brand-confirm-${brand}`}
              label={`Confirm ${brandName} password`}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={confirmMismatch}
            />
            {confirmMismatch ? (
              <p className="text-xs text-destructive">Both passwords must match.</p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <DialogClose render={<Button variant="ghost" type="button">Cancel</Button>} />
              <Button type="submit" disabled={!canSubmit}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Set password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The inline enter-address → enter-passcode → done flow. */
function AddEmailFlow({
  knownEmails,
  primaryEmail,
  perEmailActivationAvailable,
  onCancel,
  onLinked,
}: {
  knownEmails: string[]
  primaryEmail: string | null
  perEmailActivationAvailable: boolean
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
      // On the UK Model-3 experience we keep the person in /profile on the done
      // step so they can act on the immediate "set a separate password" next
      // step for this exact address. Everywhere else, auto-close as before.
      if (!perEmailActivationAvailable) {
        setTimeout(() => onLinked(), 1800)
      }
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
        <div className="space-y-3">
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
          {shouldOfferPostVerificationPassword({
            perEmailActivationAvailable,
            verifiedEmail: normalizedEmail,
            primaryEmail,
          }) ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="min-w-0 text-xs text-muted-foreground">
                Next: give this email its own password so it signs in independently.
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <ActivatePerEmailDialog
                  secondaryEmail={normalizedEmail}
                  primaryEmail={primaryEmail}
                  triggerLabel="Set separate password"
                  onActivated={onLinked}
                />
                <Button type="button" variant="ghost" size="sm" onClick={onLinked}>
                  Not now
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * "Make primary" — a subtle text button on any non-primary verified email row.
 * POSTs the chosen address to /api/account/emails/primary; on success it
 * revalidates the profile so the "Primary" / "Signs you in too" labels update
 * in place. On failure it shows a brief inline Note under the row. This changes
 * only the displayed designation — the password and database identity email are
 * untouched (one account, one MAU).
 */
function MakePrimaryButton({
  email,
  onDone,
  onError,
}: {
  email: string
  onDone: () => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function makePrimary() {
    setBusy(true)
    onError("")
    try {
      const res = await fetch("/api/account/emails/primary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        onError(json.error ?? "We couldn't update this right now. Please try again.")
        setBusy(false)
        return
      }
      setBusy(false)
      onDone()
    } catch {
      onError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      onClick={makePrimary}
      disabled={busy}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : null}
      Make primary
    </Button>
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
      ) : !data ? (
        <Note>Loading…</Note>
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
  rightWrap = false,
  children,
}: {
  icon: React.ReactNode
  name: string
  line: React.ReactNode
  right?: React.ReactNode
  /**
   * When the right slot is a non-action text status (not a button), set this so
   * it may shrink and wrap instead of forcing the row to its max-content width.
   * A fixed-width `shrink-0` status like "Managed in Brand passwords above"
   * otherwise creates horizontal overflow on narrow screens (GLSCM-4834).
   * Action buttons keep the default `shrink-0` so they never wrap.
   */
  rightWrap?: boolean
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
            <h3 className="min-w-0 text-sm font-bold text-foreground">{name}</h3>
            {right ? (
              <div className={methodRowRightSlotClass(rightWrap)}>{right}</div>
            ) : null}
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

  // Result of the explicit link round trip: the complete route redirects back
  // to /profile?google=linked | in_use | error. Surface it in this row in plain
  // language — customers read this page — and, on success, revalidate so the
  // row flips to "Connected as …".
  const searchParams = useSearchParams()
  const linkResult = searchParams.get("google")
  useEffect(() => {
    if (linkResult === "linked") void mutate()
  }, [linkResult, mutate])

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
            onClick={() =>
              window.location.assign("/api/account/identities/google/start")
            }
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
        {linkResult === "linked" ? (
          <div className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Google connected. You can now sign in with Google, and it stays
              part of this one profile.
            </span>
          </div>
        ) : null}
        {linkResult === "in_use" ? (
          <div className="mt-2">
            <Note tone="error">
              That Google account is already used to sign in to another Stanley
              Black &amp; Decker account, so it can&apos;t also sign in to this
              one. Sign in to that account to manage it, or use a different
              Google account.
            </Note>
          </div>
        ) : null}
        {linkResult === "error" ? (
          <div className="mt-2">
            <Note tone="error">
              We couldn&apos;t connect Google just now. Please try again.
            </Note>
          </div>
        ) : null}
      </div>
    </MethodRow>
  )
}

// ---------------------------------------------------------------------------
// Password credentials (Models 3 & 4, customer-facing)
// ---------------------------------------------------------------------------
// The real password arrangements on the account, phrased entirely in customer
// language. NO internal vocabulary ("case 3", "per-email", "per-brand",
// connection names, Auth0, bindings) ever reaches the screen — we read the raw
// login-methods rows but derive our own labels from `connectionKey`/`email`.

interface PasswordMethodView {
  key: string
  kind: string
  connectionKey?: "shared" | "per-email" | "dewalt" | "stanley"
  brand?: string
  email?: string
  resetBindingId?: string
  canReset?: boolean
}

// The exact credential a change targets, described for the customer BEFORE any
// entry. The server independently re-derives + re-allow-lists the target from
// the session, so this is presentation only — never a trust boundary.
interface ChangeTarget {
  /** Selector the browser is allowed to send (never Auth0 coordinates). */
  selector: PasswordChangeSelector
  /** Credential name, e.g. "Account password" / "DeWalt password for a@x.com". */
  label: string
  /**
   * Properly-cased dialog title + accessible name, e.g. "Change DeWalt password
   * for a@x.com". Kept separate from `label` so the brand stays capitalized —
   * lower-casing the label produced the wrong "Change dewalt password…".
   */
  title: string
  /** Plain-English scope line shown under the title. */
  line: string
  /** Optional brand chip. */
  brand?: "dewalt" | "stanley"
}

// Build the in-site change target for one password credential, in customer
// language per the stakeholder spec:
//   • Models 1-2 (shared): "Account password" — works for all verified emails.
//   • Model 3 (per-email): "Password for <email>" — other emails unaffected.
//   • Model 4 (per-brand): "<DeWalt|Stanley> password for <email>" — other brand
//     unaffected.
// Returns null for a credential we can't safely target from the browser (a
// non-shared credential with no binding id): the row then shows the neutral
// "managed with your account" note instead of an unusable dialog.
function changeTargetForMethod(method: PasswordMethodView): ChangeTarget | null {
  const key = method.connectionKey
  const email = method.email

  if (key === "per-email") {
    if (!method.resetBindingId) return null
    return {
      selector: { bindingId: method.resetBindingId },
      label: `Password for ${email ?? "this email"}`,
      title: `Change password for ${email ?? "this email"}`,
      line: `${email ?? "This email"} has its own password. Changing it will not affect your other sign-in emails.`,
    }
  }

  if (key === "dewalt" || key === "stanley") {
    if (!method.resetBindingId) return null
    const brandName = key === "dewalt" ? "DeWalt" : "Stanley"
    return {
      selector: { bindingId: method.resetBindingId },
      label: `${brandName} password${email ? ` for ${email}` : ""}`,
      // Capitalized brand + exact email — never lower-cased.
      title: `Change ${brandName} password${email ? ` for ${email}` : ""}`,
      line: `This is your ${brandName} sign-in password${email ? ` for ${email}` : ""}. Changing it will not affect your other brand password.`,
      brand: key,
    }
  }

  // Shared (Models 1-2): the account-wide password.
  return {
    selector: { scope: "shared" },
    label: "Account password",
    title: "Change account password",
    line: "Works with all your verified account emails across DeWalt and Stanley sites.",
  }
}

/** A labelled password field with an accessible show/hide toggle. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  invalid?: boolean
  describedBy?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={show}
          tabIndex={-1}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  )
}

// In-site password CHANGE dialog. Opens over /profile (never navigates away),
// clearly identifies the exact credential first, then collects current + new +
// confirm passwords and posts to the authenticated /api/account/password-change
// route. All sensitive fields are cleared on close and on success.
function ChangePasswordDialog({
  target,
  live,
  onChanged,
  triggerLabel = "Change password",
  triggerAriaLabel,
}: {
  target: ChangeTarget
  live: boolean
  onChanged?: () => void
  /** Visible trigger label; the Brand section passes "Change {Brand} password". */
  triggerLabel?: string
  /**
   * Accessible name for the trigger when the visible label is ambiguous. The
   * per-email rows keep the compact "Change password" text but pass
   * "Change password for {email}" here so screen readers get the exact target
   * (GLSCM-4834).
   */
  triggerAriaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const policy = validateNewPassword(next, SITE_MARKET)
  const confirmMismatch = confirm.length > 0 && confirm !== next
  const reuse = next.length > 0 && next === current
  const canSubmit = !busy && canSubmitPasswordChange({ current, next, confirm, market: SITE_MARKET })

  function wipe() {
    setCurrent("")
    setNext("")
    setConfirm("")
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      // Clear sensitive state whenever the dialog closes.
      wipe()
      setError(null)
      setDone(null)
      setBusy(false)
    }
  }

  async function submit() {
    setError(null)
    setDone(null)
    if (!canSubmit) return
    if (!live) {
      // Demo mode never has a real session; show an honest, non-fake result.
      setDone(
        "In production this verifies your current password and updates it securely. This demo doesn't change real credentials.",
      )
      wipe()
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/password-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...target.selector,
          currentPassword: current,
          newPassword: next,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        credential?: { label?: string; email?: string }
      }
      if (!res.ok || !json.ok) {
        setError(json.error ?? "We couldn't change your password. Please try again.")
        return
      }
      wipe()
      setDone(`${json.credential?.label ?? target.label} updated.`)
      onChanged?.()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" aria-label={triggerAriaLabel}>
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{target.title}</span>
            {target.brand ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {target.brand === "dewalt" ? "DeWalt" : "Stanley"}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>{target.line}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <Note>
              <span className="inline-flex items-center gap-2">
                <BadgeCheck className="size-4 text-primary" />
                {done}
              </span>
            </Note>
            <DialogFooter>
              <DialogClose render={<Button>Done</Button>} />
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="space-y-4"
          >
            <PasswordField
              id={`pw-current-${target.label}`}
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              invalid={Boolean(error)}
            />
            <PasswordField
              id={`pw-new-${target.label}`}
              label="New password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              invalid={next.length > 0 && !policy.ok}
              describedBy={`pw-policy-${target.label}`}
            />
            {/* Concise policy checklist — validation, not feature copy. */}
            <ul id={`pw-policy-${target.label}`} className="space-y-1 text-xs text-muted-foreground">
              {newPasswordChecklist(next, SITE_MARKET).map((r) => (
                <li key={r.text} className="flex items-center gap-1.5">
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      r.ok ? "text-primary" : "text-muted-foreground/40",
                    )}
                  />
                  <span className={cn(r.ok && "text-foreground")}>{r.text}</span>
                </li>
              ))}
            </ul>
            <PasswordField
              id={`pw-confirm-${target.label}`}
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={confirmMismatch}
              describedBy={confirmMismatch ? `pw-confirm-error-${target.label}` : undefined}
            />
            {confirmMismatch ? (
              <p id={`pw-confirm-error-${target.label}`} className="text-xs text-destructive">
                Both new passwords must match.
              </p>
            ) : null}
            {reuse ? (
              <p className="text-xs text-destructive">
                Choose a password different from your current one.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <DialogClose render={<Button variant="ghost" type="button">Cancel</Button>} />
              <Button type="submit" disabled={!canSubmit}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Change password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// One password-credential row with its own in-site "Change password" action.
// The change opens a dialog over /profile (no redirect) and posts to the
// authenticated /api/account/password-change route, which re-derives and
// re-allow-lists the exact target from the signed-in session.
function PasswordCredentialRow({
  method,
  live,
  hideBrandPasswordControls = false,
}: {
  method: PasswordMethodView
  live: boolean
  hideBrandPasswordControls?: boolean
}) {
  const target = method.canReset !== false ? changeTargetForMethod(method) : null
  const isBrandCredential =
    method.connectionKey === "dewalt" || method.connectionKey === "stanley"
  // When the prominent Brand passwords section owns this action, don't render a
  // second Change control here — point up to it instead so the action isn't
  // offered twice (GLSCM-4834).
  const suppressChange = hideBrandPasswordControls && isBrandCredential

  return (
    <MethodRow
      icon={<KeyRound className="size-4" />}
      name={passwordCredentialLabel(method)}
      line={passwordCredentialLine(method)}
      rightWrap={passwordRowRightIsWrappingStatus({
        suppressChange,
        hasChangeTarget: Boolean(target),
      })}
      right={
        suppressChange ? (
          <span className="text-xs leading-relaxed text-muted-foreground text-balance">
            Managed in Brand passwords above
          </span>
        ) : target ? (
          <ChangePasswordDialog target={target} live={live} />
        ) : (
          <span
            className="text-xs leading-relaxed text-muted-foreground text-balance"
            title="This password is managed with your main account sign-in"
          >
            Managed with your account
          </span>
        )
      }
    />
  )
}

// In-site "Add password" activation for a verified alternate email that has no
// password of its own yet. Opens over /profile (no redirect, no model
// vocabulary). It names BOTH operations plainly: confirm the CURRENT password
// for the primary email, then set a DIFFERENT new password for the exact
// alternate email. On success the account holds two independent per-email
// passwords and the caller refreshes so the two rows + controls appear.
function ActivatePerEmailDialog({
  secondaryEmail,
  primaryEmail,
  triggerLabel = "Set separate password",
  triggerAriaLabel,
  onActivated,
}: {
  secondaryEmail: string
  primaryEmail: string | null
  triggerLabel?: string
  /** Accessible name naming the exact email (GLSCM-4834). */
  triggerAriaLabel?: string
  onActivated?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const policy = validateNewPassword(next, SITE_MARKET)
  const confirmMismatch = confirm.length > 0 && confirm !== next
  const canSubmit =
    !busy && current.length > 0 && policy.ok && confirm === next && confirm.length > 0

  function wipe() {
    setCurrent("")
    setNext("")
    setConfirm("")
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      wipe()
      setError(null)
      setDone(null)
      setBusy(false)
    }
  }

  async function submit() {
    setError(null)
    if (!canSubmit) return
    setBusy(true)
    try {
      const res = await fetch("/api/account/passwords/per-email-activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secondaryEmail,
          currentPassword: current,
          newPassword: next,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        activated?: boolean
        error?: string
      }
      if (!res.ok || !json.activated) {
        setError(json.error ?? "We couldn't set up that password. Please try again.")
        return
      }
      wipe()
      setDone(`${secondaryEmail} now has its own password.`)
      onActivated?.()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus className="size-4" />
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a password for {secondaryEmail}</DialogTitle>
          <DialogDescription>
            Confirm your current password for {primaryEmail ?? "your primary email"}, then choose a
            different password for {secondaryEmail}. Afterwards each email signs in with its own
            password.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <Note>
              <span className="inline-flex items-center gap-2">
                <BadgeCheck className="size-4 text-primary" />
                {done}
              </span>
            </Note>
            <DialogFooter>
              <DialogClose render={<Button>Done</Button>} />
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="space-y-4"
          >
            <PasswordField
              id={`activate-current-${secondaryEmail}`}
              label={`Current password for ${primaryEmail ?? "your primary email"}`}
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              invalid={Boolean(error)}
            />
            <div className="h-px bg-border" role="presentation" />
            <PasswordField
              id={`activate-new-${secondaryEmail}`}
              label={`New password for ${secondaryEmail}`}
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              invalid={next.length > 0 && !policy.ok}
              describedBy={`activate-policy-${secondaryEmail}`}
            />
            <ul
              id={`activate-policy-${secondaryEmail}`}
              className="space-y-1 text-xs text-muted-foreground"
            >
              {newPasswordChecklist(next, SITE_MARKET).map((r) => (
                <li key={r.text} className="flex items-center gap-1.5">
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      r.ok ? "text-primary" : "text-muted-foreground/40",
                    )}
                  />
                  <span className={cn(r.ok && "text-foreground")}>{r.text}</span>
                </li>
              ))}
            </ul>
            <PasswordField
              id={`activate-confirm-${secondaryEmail}`}
              label={`Confirm new password for ${secondaryEmail}`}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={confirmMismatch}
            />
            {confirmMismatch ? (
              <p className="text-xs text-destructive">Both new passwords must match.</p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <DialogClose render={<Button variant="ghost" type="button">Cancel</Button>} />
              <Button type="submit" disabled={!canSubmit}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Add password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// The password-credentials block inside "How you sign in". Reads the REAL
// credentials from login-methods (one reset per credential).
//
// The per-email "set separate password" activation now lives directly beside
// each verified email in the Email addresses section (GLSCM-4834), where it is
// discoverable — so this block no longer renders activation rows. It returns
// its rows as DIRECT <li> children (via MethodRow, which is an <li>) so the
// surrounding <ul> stays valid — no <li> nested in <li>, no wrapping <div>.
// Loading and failure never fabricate a credential: they render honest neutral
// <li> states, and a genuinely password-less account shows an honest empty row.
function PasswordCredentials({
  live,
  hideBrandPasswordControls = false,
  perEmailManaged = false,
}: {
  live: boolean
  hideBrandPasswordControls?: boolean
  /**
   * Model 3 (per-email): password management is single-source beside each email
   * in the Email addresses section. When true, the sign-in list shows ONE
   * non-action summary row instead of repeating each credential (which would
   * otherwise duplicate the change actions and surface a confusing brand-DB
   * "DeWalt password" row inside a per-email model) — GLSCM-4834.
   */
  perEmailManaged?: boolean
}) {
  // Fetch the real login-methods UNLESS the parent already told us per-email
  // owns password management (then we render the summary without a fetch). When
  // the flag is not forwarded we still fetch and DETECT per-email ownership from
  // the methods themselves, so a Model 3 account can never fall through to the
  // per-credential rows (GLSCM-4834 follow-up 5).
  const { data: methodsData, error: methodsError } = useSWR<{
    configured: boolean
    methods: PasswordMethodView[]
  }>(live && !perEmailManaged ? "/api/account/login-methods" : null, fetcher, {
    onError: (err) => warnUnavailable("Passwords", (err as { status?: number })?.status),
  })

  const display = resolveSignInPasswordDisplay({
    perEmailManaged,
    methodsLoaded: Boolean(methodsData),
    methods: methodsData?.methods ?? [],
  })

  // Model 3: point up to the Email addresses section — no per-credential rows.
  if (display === "summary") {
    const summary = planSignInPasswordRows({ perEmailManaged: true })
    return summary.mode === "summary" ? (
      <MethodRow
        icon={<KeyRound className="size-4" />}
        name={summary.name}
        line={summary.line}
      />
    ) : null
  }

  // Failure takes precedence over the pending placeholder.
  if (methodsError) {
    return (
      <li className="rounded-xl border border-border bg-background px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          We couldn&apos;t load your sign-in passwords right now. Please refresh to try again.
        </p>
      </li>
    )
  }

  // Still loading: no data and no error yet. Restrained placeholder — never a
  // fabricated "Account password".
  if (display === "pending") {
    return (
      <li className="rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span>Loading your sign-in passwords…</span>
        </div>
      </li>
    )
  }

  // Failure: clear, neutral unavailable state — again, no invented credential.
  if (methodsError) {
    return (
      <li className="rounded-xl border border-border bg-background px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          We couldn&apos;t load your sign-in passwords right now. Please refresh to try again.
        </p>
      </li>
    )
  }

  const passwords = (methodsData?.methods ?? []).filter((m) => m.kind === "password")

  return (
    <>
      {passwords.length === 0 ? (
        <MethodRow
          icon={<KeyRound className="size-4" />}
          name="No password yet"
          line="You don't have a password on this account — you sign in with an email passcode or a linked method."
        />
      ) : (
        passwords.map((m) => (
          <PasswordCredentialRow
            key={m.key}
            method={m}
            live={live}
            hideBrandPasswordControls={hideBrandPasswordControls}
          />
        ))
      )}
    </>
  )
}

function SignInSection({
  live,
  primaryEmail,
  hideBrandPasswordControls = false,
  perEmailManaged = false,
}: {
  live: boolean
  primaryEmail: string | null
  /**
   * When the prominent Brand passwords section is rendered above (Model 4), the
   * sign-in list must not ALSO show a Change control for each brand password —
   * that would surface the same action twice. The brand rows still appear here
   * as informational sign-in methods, but their Change control is replaced with
   * a pointer to the Brand passwords section (GLSCM-4834).
   */
  hideBrandPasswordControls?: boolean
  /**
   * When the Email addresses section owns per-email password actions (Model 3),
   * the sign-in list collapses the individual password credential rows into one
   * non-action "Email passwords" summary row (GLSCM-4834).
   */
  perEmailManaged?: boolean
}) {
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
      ) : !data ? (
        <Note>Loading…</Note>
      ) : (
        <ul className="space-y-2">
          {/* 1 — Password credentials (real Model 3 & 4 arrangements + Add).
                  Renders its own <li> rows directly into this <ul>. */}
          <PasswordCredentials
            live={live}
            hideBrandPasswordControls={hideBrandPasswordControls}
            perEmailManaged={perEmailManaged}
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
