"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  BadgeCheck,
  Braces,
  Building2,
  Check,
  ClipboardCheck,
  Clock,
  Code2,
  Database,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  Globe,
  History,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Megaphone,
  Network,
  Pencil,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  User,
  X,
} from "lucide-react"
import { useApp } from "@/components/app-providers"
import { EmailVerificationStatus } from "@/components/email-verification-status"
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
import { hasSharedPasswordCredential } from "@/lib/credential-model"
import {
  canSubmitPasswordChange,
  validateNewPassword,
  type PasswordChangeSelector,
} from "@/lib/password-change"
import { newPasswordChecklist } from "@/lib/password-policy"
import { SITE_MARKET } from "@/lib/site"
import { buildAuthLoginUrl, startAuthRedirect } from "@/lib/auth0-connections"
import {
  DOWNSTREAM_CATEGORY_LABELS,
  ERASURE_ACTION_LABELS,
  type ErasureAction,
  type ErasurePlan,
  type ErasureReceipt,
} from "@/lib/erasure"
import {
  COMMUNICATION_CHANNELS,
  CONSENT_TOPICS,
  COUNTRY_OPTIONS,
  DEFAULT_CONSENT,
  DEFAULT_PREFERENCES,
  LANGUAGE_OPTIONS,
  LOCALE_OPTIONS,
  PREFERRED_LOGIN_OPTIONS,
  type CommunicationChannel,
  type ConsentState,
  type ConsentTopic,
  type SitePreferences,
} from "@/lib/metadata-schema"

// REAL AUTH0 ACCOUNT CENTER
// =========================
// Rendered by /account when a genuine Auth0 session cookie is present.
//
// Two modes, decided at runtime by GET /api/account/status:
//
//   • Management API CONFIGURED  → sections marked "Live" read real data from
//     the Okta / Auth0 Management API and their actions call the /api/account/*
//     routes (profile/email, password-reset ticket, MFA, passkeys, connected
//     accounts, organizations, export, deletion).
//   • NOT configured             → the original cinematic "Demo" simulation
//     runs (local state only), so the showcase never breaks. See
//     FEATURE_BACKLOG.md Part 3 for the env vars + dashboard setup that flip it live.

interface RealAccountProps {
  user: Record<string, unknown>
}

// Throw on non-OK responses so SWR populates `error` (not `data`) on failure.
// Without this, a 403/500 body like `{ error: "..." }` lands in `data` and any
// `data.organizations.length`-style access crashes the whole page.
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

// Diagnostic split — READ THIS BEFORE EDITING THE FAILURE STRINGS BELOW.
//
// This account centre is shown on a projector to a non-technical audience, so
// the on-screen copy for a Live-section failure stays plain English and says
// what the person can do. The technical story a developer needs — the HTTP
// status and the exact Management API scopes the call requires — is written to
// the browser console here instead. A developer with dev tools open still gets
// the full picture; the executive watching does not see status codes or scope
// names that read like a broken build.
//
// Keep it this way. Do NOT "helpfully" move the status code, the scope names, or
// "client-credentials grant" back into any visible <Note>. This warning is where
// they belong. Only a 403 (missing Management API authorization) gets the
// scope-specific message; any other status is reported plainly.
function warnManagementApiUnavailable(
  section: string,
  scopes: string[],
  status?: number,
) {
  if (status === 403) {
    console.warn(
      `[SBD account centre] Live "${section}" could not load: the Auth0 Management API returned 403 (not authorized). ` +
        `This call needs the scope(s) ${scopes.join(", ")}, granted to the dedicated M2M app via a client grant on the ` +
        `Management API (client-credentials grant). Confirm AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET are set on this ` +
        `deployment and that the client grant includes those scopes.`,
    )
    return
  }
  console.warn(
    `[SBD account centre] Live "${section}" could not load: the account API returned ${
      status ?? "an unexpected error"
    }.`,
  )
}

/** Map an Auth0 `sub` prefix to a human-readable sign-in connection. */
function connectionFromSub(sub: string | undefined): {
  label: string
  icon: typeof KeyRound
} {
  if (!sub) return { label: "Unknown", icon: KeyRound }
  const prefix = sub.split("|")[0]
  switch (prefix) {
    case "google-oauth2":
      return { label: "Google", icon: Code2 }
    case "apple":
      return { label: "Apple", icon: Code2 }
    case "windowslive":
      return { label: "Microsoft", icon: Code2 }
    case "facebook":
      return { label: "Facebook", icon: Code2 }
    case "github":
      return { label: "GitHub", icon: Code2 }
    case "linkedin":
      return { label: "LinkedIn", icon: Code2 }
    case "twitter":
      return { label: "X", icon: Code2 }
    case "auth0":
      return { label: "Email & password", icon: KeyRound }
    default:
      return { label: prefix, icon: KeyRound }
  }
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
      <ShieldCheck className="size-3" />
      Live
    </span>
  )
}

function DemoTag() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      title="Simulated — does not call the Okta / Auth0 Management API yet"
    >
      Demo
    </span>
  )
}

function SectionCard({
  icon,
  title,
  tag,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  tag: React.ReactNode
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          {icon}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            {tag}
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Row({
  label,
  value,
  mono,
  action,
}: {
  label: string
  value: string
  mono?: boolean
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "truncate text-sm text-foreground",
            mono ? "font-mono" : "font-medium",
          )}
        >
          {value}
        </p>
      </div>
      {action}
    </div>
  )
}

/** Small inline status note used to surface route results. */
function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error" | "danger"
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        "mt-3 rounded-lg px-3 py-2 text-xs",
        tone === "error" && "bg-destructive/10 font-medium text-destructive",
        tone === "danger" && "bg-background font-medium text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </p>
  )
}

interface Org {
  id: string
  name: string
  kind: "Personal" | "Organization"
  role: string
}

/** Client mirror of lib/auth0-management's LoginMethod (server-only module). */
interface LoginMethodView {
  key: string
  kind: "password" | "social" | "passkey"
  label: string
  detail?: string
  isPrimary: boolean
  removable: boolean
  provider?: string
  userId?: string
  methodId?: string
  // Password-credential enrichment (case 3 per-email / case 4 per-brand).
  connectionKey?: "shared" | "per-email" | "dewalt" | "stanley"
  scope?: string
  brand?: "dewalt" | "craftsman" | "stanley"
  email?: string
  resetBindingId?: string
  canReset?: boolean
}

/** Demo seed: a primary password plus two removable extras to "forget." */
const DEMO_LOGIN_METHODS: LoginMethodView[] = [
  {
    key: "auth0|demo",
    kind: "password",
    label: "Email & password",
    isPrimary: true,
    removable: false,
  },
  {
    key: "google-oauth2|demo",
    kind: "social",
    label: "Google",
    detail: "you@gmail.com",
    isPrimary: false,
    removable: true,
    provider: "google-oauth2",
    userId: "demo",
  },
  {
    key: "passkey:demo",
    kind: "passkey",
    label: "Passkey",
    detail: "Added today",
    isPrimary: false,
    removable: true,
    methodId: "demo",
  },
]

function MethodIcon({ kind }: { kind: LoginMethodView["kind"] }) {
  const Icon =
    kind === "passkey" ? Fingerprint : kind === "password" ? KeyRound : Code2
  return <Icon className="size-4 text-primary" />
}

// The exact credential a change targets, described for the customer BEFORE any
// entry. The server independently re-derives + re-allow-lists the target from
// the session, so this is presentation only — never a trust boundary.
interface ChangeTarget {
  /** Selector the browser is allowed to send (never coordinates). */
  selector: PasswordChangeSelector
  /** Credential name, e.g. "Account password" / "DeWalt password". */
  label: string
  /** Plain-English scope line shown under the title. */
  line: string
  /** Optional brand chip. */
  brand?: "dewalt" | "stanley" | "craftsman"
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

/**
 * In-site password CHANGE dialog. Opens over /profile (never navigates away),
 * clearly identifies the exact credential first, then collects current + new +
 * confirm passwords and posts to the authenticated /api/account/password-change
 * route. All sensitive fields are cleared on close and on success.
 */
function ChangePasswordDialog({
  target,
  live,
  onChanged,
}: {
  target: ChangeTarget
  live: boolean
  onChanged?: () => void
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
        "In production this verifies your current password and updates it via the Auth0 Management API. This demo doesn't change real credentials.",
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
          <Button variant="outline" size="sm">
            Change password
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Change {target.label.toLowerCase()}</span>
            {target.brand ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {target.brand === "dewalt"
                  ? "DeWalt"
                  : target.brand === "stanley"
                    ? "Stanley"
                    : target.brand}
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
              id="pw-current"
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              invalid={Boolean(error)}
            />
            <PasswordField
              id="pw-new"
              label="New password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              invalid={next.length > 0 && !policy.ok}
              describedBy="pw-policy"
            />
            {/* Concise policy checklist — validation, not feature copy. */}
            <ul id="pw-policy" className="space-y-1 text-xs text-muted-foreground">
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
              id="pw-confirm"
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={confirmMismatch}
              describedBy={confirmMismatch ? "pw-confirm-error" : undefined}
            />
            {confirmMismatch ? (
              <p id="pw-confirm-error" className="text-xs text-destructive">
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

/** A single sign-in method row with a confirmation dialog before removal. */
function ForgetMethodButton({
  method,
  busy,
  onConfirm,
}: {
  method: LoginMethodView
  busy: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy}
          />
        }
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
        Forget
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forget {method.label}?</DialogTitle>
          <DialogDescription>
            You&apos;ll no longer be able to sign in with {method.label}. You can
            always add it back later, and your account and data stay exactly as
            they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep it</DialogClose>
          <DialogClose
            render={
              <Button variant="destructive" onClick={onConfirm}>
                Forget this method
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RealAccount({ user }: RealAccountProps) {
  const { setTokenInspectorOpen, logout } = useApp()

  const name =
    (user.name as string) ?? (user.nickname as string) ?? "Signed-in user"
  // Locally tracked so an Edit-profile save updates the header immediately.
  const [displayName, setDisplayName] = useState(name)
  const email = (user.email as string | undefined) ?? null
  const emailVerified = Boolean(user.email_verified)
  const picture = user.picture as string | undefined
  // Locally tracked so an avatar change updates the header immediately.
  const [displayPicture, setDisplayPicture] = useState(picture)
  const sub = user.sub as string | undefined
  const updatedAt = user.updated_at as string | undefined
  const connection = useMemo(() => connectionFromSub(sub), [sub])

  // Is the Management API wired up? Decides live vs Demo for every section.
  const { data: status } = useSWR<{
    authConfigured: boolean
    managementConfigured: boolean
    hardDeleteEnabled: boolean
  }>("/api/account/status", fetcher)
  const live = Boolean(status?.managementConfigured)

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      {/* Header */}
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
          <h1 className="brand-display text-2xl text-foreground">
            {displayName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {email ? (
              <span className="text-sm text-muted-foreground">{email}</span>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-foreground">
              <BadgeCheck className="size-3.5 text-primary" />
              Real Auth0 session
            </span>
          </div>
        </div>
      </header>

      {/* Mode banner */}
      <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
        {live ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Connected to the Okta / Auth0 Management API. Sections marked{" "}
            <LiveTag /> read and write your real directory record. Actions here
            change your actual account, so use care.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            This account center is a working prototype. Fields marked <LiveTag />{" "}
            come from your real Auth0 ID-token claims. Actions marked <DemoTag />{" "}
            are simulated for the demo and don&apos;t yet call the Okta / Auth0
            Management API — they only change what you see on this page.
          </p>
        )}
      </div>

      <div className="mt-6 space-y-5">
        <ProfileSection
          live={live}
          name={displayName}
          email={email}
          emailVerified={emailVerified}
          connectionLabel={connection.label}
          sub={sub}
          updatedAt={updatedAt}
          picture={displayPicture}
          onInspect={() => setTokenInspectorOpen(true)}
          onNameChange={setDisplayName}
          onPictureChange={setDisplayPicture}
        />

        <PreferencesSection live={live} />

        <SecuritySection live={live} connectionLabel={connection.label} />

        <OrganizationsSection live={live} />

        <ConsentSection live={live} />

        <PrivacySection live={live} hardDelete={Boolean(status?.hardDeleteEnabled)} onDeleted={() => logout()} />
      </div>

      {/* Sign out — canonical logout (see lib/logout.ts). */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-5" />
          Sign out
        </button>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Profile & identity
// ---------------------------------------------------------------------------
type ProfileFields = {
  name: string
  given_name: string
  family_name: string
  nickname: string
  picture: string
  phone_number: string
}

// Plain string fields sent verbatim (after trim) to the profile route.
const EDITABLE_TEXT_FIELDS = [
  "name",
  "given_name",
  "family_name",
  "nickname",
] as const

function ProfileSection({
  live,
  name,
  email,
  emailVerified,
  connectionLabel,
  sub,
  updatedAt,
  picture,
  onInspect,
  onNameChange,
  onPictureChange,
}: {
  live: boolean
  name: string
  email: string | null
  emailVerified: boolean
  connectionLabel: string
  sub: string | undefined
  updatedAt: string | undefined
  picture: string | undefined
  onInspect: () => void
  onNameChange: (name: string) => void
  onPictureChange: (picture: string | undefined) => void
}) {
  // Live: pull the granular name fields (given/family/nickname) that the
  // ID-token claims don't reliably include. Demo: nothing to fetch.
  const { data: profileData, mutate } = useSWR<{
    configured: boolean
    user: Record<string, unknown>
  }>(live ? "/api/account/profile" : null, fetcher)

  // Saved values drive the display; draft is the editable working copy.
  const [saved, setSaved] = useState<ProfileFields>({
    name,
    given_name: "",
    family_name: "",
    nickname: "",
    picture: picture ?? "",
    phone_number: "",
  })
  const [draft, setDraft] = useState<ProfileFields>(saved)
  const [seeded, setSeeded] = useState(false)

  // Seed the granular fields once the live profile arrives.
  if (live && profileData?.user && !seeded) {
    const u = profileData.user
    const meta = (u.user_metadata as Record<string, unknown> | undefined) ?? {}
    const next: ProfileFields = {
      name: (u.name as string) ?? name ?? "",
      given_name: (u.given_name as string) ?? "",
      family_name: (u.family_name as string) ?? "",
      nickname: (u.nickname as string) ?? "",
      picture: (u.picture as string) ?? "",
      phone_number: (meta.phone_number as string) ?? "",
    }
    setSaved(next)
    setDraft(next)
    setSeeded(true)
  }

  // Profile-edit state.
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editNote, setEditNote] = useState<string | null>(null)

  function setField(key: keyof ProfileFields, value: string) {
    setEditError(null)
    setEditNote(null)
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function submitProfile() {
    setEditError(null)
    setEditNote(null)
    // Only send fields that actually changed.
    const payload: Record<string, string> = {}
    for (const k of EDITABLE_TEXT_FIELDS) {
      const v = draft[k].trim()
      if (v && v !== saved[k]) payload[k] = v
    }
    // Avatar: validate URL client-side; allow clearing back to the default.
    const nextPicture = draft.picture.trim()
    if (nextPicture !== saved.picture) {
      if (nextPicture && !/^https?:\/\/\S+$/i.test(nextPicture)) {
        setEditError("Enter a valid image URL (http or https).")
        return
      }
      payload.picture = nextPicture
    }
    // Phone: stored in user_metadata; allow clearing.
    const nextPhone = draft.phone_number.trim()
    if (nextPhone !== saved.phone_number) {
      if (nextPhone && !/^[+()\d][\d\s().-]{4,}$/.test(nextPhone)) {
        setEditError("Enter a valid phone number.")
        return
      }
      payload.phone_number = nextPhone
    }
    if (Object.keys(payload).length === 0) {
      setEditError("Change at least one field before saving.")
      return
    }
    if (!live) {
      const next: ProfileFields = {
        ...saved,
        ...payload,
        picture: "picture" in payload ? nextPicture : saved.picture,
        phone_number: "phone_number" in payload ? nextPhone : saved.phone_number,
      }
      setSaved(next)
      setDraft(next)
      if (payload.name) onNameChange(payload.name)
      if ("picture" in payload) onPictureChange(nextPicture || undefined)
      setEditNote("Profile updated. (Simulated — no Management API call.)")
      return
    }
    setEditBusy(true)
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEditError(json.error ?? "Update failed.")
      } else {
        const u = (json.user ?? {}) as Record<string, unknown>
        const meta = (u.user_metadata as Record<string, unknown> | undefined) ?? {}
        const next: ProfileFields = {
          name: (u.name as string) ?? draft.name,
          given_name: (u.given_name as string) ?? draft.given_name,
          family_name: (u.family_name as string) ?? draft.family_name,
          nickname: (u.nickname as string) ?? draft.nickname,
          picture: (u.picture as string) ?? nextPicture,
          phone_number: (meta.phone_number as string) ?? nextPhone,
        }
        setSaved(next)
        setDraft(next)
        onNameChange(next.name)
        onPictureChange(next.picture || undefined)
        setEditNote("Profile saved to your Auth0 directory record.")
        mutate()
      }
    } catch {
      setEditError("Network error. Please try again.")
    } finally {
      setEditBusy(false)
    }
  }

  const [newEmail, setNewEmail] = useState("")
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitEmail() {
    setError(null)
    if (!newEmail) return
    if (!live) {
      // Demo: just simulate the pending-verification state.
      setPendingEmail(newEmail)
      setNewEmail("")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Update failed.")
      } else {
        setPendingEmail(newEmail)
        setNewEmail("")
      }
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      icon={<User className="size-5" />}
      title="Profile &amp; identity"
      tag={<LiveTag />}
      description="The core claims Auth0 returned for your session."
    >
      <div className="divide-y divide-border">
        <Row label="Full name" value={saved.name || name} />
        {saved.given_name ? (
          <Row label="Given name" value={saved.given_name} />
        ) : null}
        {saved.family_name ? (
          <Row label="Family name" value={saved.family_name} />
        ) : null}
        {saved.nickname ? (
          <Row label="Nickname" value={saved.nickname} />
        ) : null}
        {saved.phone_number ? (
          <Row label="Phone" value={saved.phone_number} />
        ) : null}
        {email ? (
          <Row
            label="Email"
            value={email}
            action={
              emailVerified ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <BadgeCheck className="size-3.5" />
                  Verified
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Unverified</span>
              )
            }
          />
        ) : null}
        <Row label="Sign-in connection" value={connectionLabel} action={<LiveTag />} />
        {sub ? <Row label="User ID (sub)" value={sub} mono /> : null}
        {updatedAt ? (
          <Row
            label="Profile last updated"
            value={new Date(updatedAt).toLocaleString()}
          />
        ) : null}
      </div>
      <EmailVerificationStatus
        key={pendingEmail ?? email ?? "no-email"}
        live={live}
        email={pendingEmail ?? email}
        initialVerified={pendingEmail ? false : emailVerified}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onInspect}>
          <Braces className="size-4" />
          Inspect tokens
        </Button>
        <Dialog>
          <DialogTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(saved)
                  setEditError(null)
                  setEditNote(null)
                }}
              />
            }
          >
            <Pencil className="size-4" />
            Edit profile
            {!live ? (
              <span className="ml-1">
                <DemoTag />
              </span>
            ) : null}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit profile</DialogTitle>
              <DialogDescription>
                {live
                  ? "Updates your name fields on your Auth0 directory record via the Management API."
                  : "In production this updates your name fields via the Auth0 Management API. Here it just updates what you see on this page."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {/* Avatar URL + live preview */}
              <div className="space-y-1.5">
                <Label htmlFor="edit-picture">Profile photo</Label>
                <div className="flex items-center gap-3">
                  {draft.picture.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.picture.trim() || "/placeholder.svg"}
                      alt=""
                      className="size-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                      {(draft.name || name).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="flex-1 space-y-1.5">
                    <Input
                      id="edit-picture"
                      type="url"
                      inputMode="url"
                      value={draft.picture}
                      onChange={(e) => setField("picture", e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                    />
                    {draft.picture.trim() ? (
                      <button
                        type="button"
                        onClick={() => setField("picture", "")}
                        className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Remove photo (use initials)
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste a public image URL. Stored as your Auth0 `picture`.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Full name</Label>
                <Input
                  id="edit-name"
                  value={draft.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="Ada Lovelace"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-given">Given name</Label>
                  <Input
                    id="edit-given"
                    value={draft.given_name}
                    onChange={(e) => setField("given_name", e.target.value)}
                    placeholder="Ada"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-family">Family name</Label>
                  <Input
                    id="edit-family"
                    value={draft.family_name}
                    onChange={(e) => setField("family_name", e.target.value)}
                    placeholder="Lovelace"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-nickname">Nickname</Label>
                <Input
                  id="edit-nickname"
                  value={draft.nickname}
                  onChange={(e) => setField("nickname", e.target.value)}
                  placeholder="ada"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Phone number</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  inputMode="tel"
                  value={draft.phone_number}
                  onChange={(e) => setField("phone_number", e.target.value)}
                  placeholder="+1 555 123 4567"
                />
                <p className="text-xs text-muted-foreground">
                  Stored in your `user_metadata`.
                </p>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <DialogClose
                render={
                  <Button disabled={editBusy} onClick={submitProfile}>
                    {editBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Save changes
                  </Button>
                }
              />
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            <Mail className="size-4" />
            Update email
            {!live ? (
              <span className="ml-1">
                <DemoTag />
              </span>
            ) : null}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update email address</DialogTitle>
              <DialogDescription>
                {live
                  ? "This updates your profile via the Auth0 Management API and resets your verified status until you confirm the new address."
                  : "In production this updates the profile via the Auth0 Management API and sends a verification email. Here it just simulates the pending-verification state."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-email">New email address</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <DialogClose
                render={
                  <Button disabled={busy} onClick={submitEmail}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    {live ? "Update email" : "Send verification"}
                  </Button>
                }
              />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {editError ? <Note tone="error">{editError}</Note> : null}
      {editNote ? <Note>{editNote}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
      {pendingEmail ? (
        <Note>
          {live ? "Email updated to " : "Verification pending for "}
          <span className="font-medium text-foreground">{pendingEmail}</span>
          {live ? " — check that inbox to verify it." : " (simulated)."}
        </Note>
      ) : null}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Site preferences (user_metadata) — user-editable, never access-affecting
// ---------------------------------------------------------------------------

/** A labelled, design-token-styled native select (no extra dependencies). */
function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A switch row used for the marketing + per-channel communication toggles. */
function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  )
}

function PreferencesSection({ live }: { live: boolean }) {
  // Live: read the user's saved preferences from user_metadata. Demo: defaults.
  const { data, error, isLoading, mutate } = useSWR<{
    configured: boolean
    preferences: SitePreferences
  }>(live ? "/api/account/preferences" : null, fetcher, {
    onError: (err) =>
      warnManagementApiUnavailable(
        "Site preferences",
        ["read:users", "update:users"],
        (err as { status?: number })?.status,
      ),
  })

  const prefsError = live ? Boolean(error) : false
  const prefs403 = (error as { status?: number } | undefined)?.status === 403

  // The saved baseline (live: from API; demo: starts at defaults).
  const [saved, setSaved] = useState<SitePreferences>(DEFAULT_PREFERENCES)
  // The editable working copy.
  const [draft, setDraft] = useState<SitePreferences>(DEFAULT_PREFERENCES)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // When live data arrives, seed both baseline and draft once.
  const loadedKey = live ? (data ? JSON.stringify(data.preferences) : null) : "demo"
  const [seededKey, setSeededKey] = useState<string | null>(null)
  if (loadedKey && loadedKey !== seededKey && live && data) {
    setSaved(data.preferences)
    setDraft(data.preferences)
    setSeededKey(loadedKey)
  }

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  )

  function set<K extends keyof SitePreferences>(key: K, value: SitePreferences[K]) {
    setNote(null)
    setSaveError(null)
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function setChannel(channel: CommunicationChannel, value: boolean) {
    setNote(null)
    setSaveError(null)
    setDraft((prev) => ({
      ...prev,
      communication_prefs: { ...prev.communication_prefs, [channel]: value },
    }))
  }

  async function save() {
    setSaveError(null)
    setNote(null)
    if (!live) {
      // Demo: persist into local baseline only.
      setSaved(draft)
      setNote("Preferences saved. (Simulated — no Management API call.)")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(json.error ?? "Could not save your preferences.")
      } else {
        const next = (json.preferences ?? draft) as SitePreferences
        setSaved(next)
        setDraft(next)
        setNote("Preferences saved to your user_metadata.")
        mutate()
      }
    } catch {
      setSaveError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setNote(null)
    setSaveError(null)
    setDraft(saved)
  }

  return (
    <SectionCard
      icon={<SlidersHorizontal className="size-5" />}
      title="Site preferences"
      tag={live ? <LiveTag /> : <DemoTag />}
      description="Personal preferences stored in user_metadata. These tailor your experience but never change what you're allowed to access."
    >
      {live && prefsError ? (
        // Plain English only — the status code and required scopes go to the
        // console via warnManagementApiUnavailable(). Do not add them here.
        <Note tone="error">
          {prefs403
            ? "We couldn't load your live preferences right now. Your saved settings are safe — please refresh the page in a moment to try again."
            : "Live preferences couldn't load right now. Please try again."}
        </Note>
      ) : live && isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your preferences…</p>
      ) : (
        <div className="space-y-6">
          {/* Region + language selects. The POC is locked to the DeWalt brand,
              so there is no brand preference — only locale-style settings. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="pref-country"
              label="Storefront country"
              value={draft.preferred_country}
              onChange={(v) => set("preferred_country", v as SitePreferences["preferred_country"])}
              options={COUNTRY_OPTIONS}
            />
            <SelectField
              id="pref-locale"
              label="Display language"
              value={draft.preferred_locale}
              onChange={(v) => set("preferred_locale", v)}
              options={LOCALE_OPTIONS}
            />
            <SelectField
              id="pref-lang"
              label="Email language"
              value={draft.lang}
              onChange={(v) => set("lang", v)}
              options={LANGUAGE_OPTIONS}
            />
            <SelectField
              id="pref-login"
              label="Preferred sign-in method"
              value={draft.preferred_login}
              onChange={(v) => set("preferred_login", v as SitePreferences["preferred_login"])}
              options={PREFERRED_LOGIN_OPTIONS}
            />
          </div>

          <Separator />

          {/* Marketing + communication channels */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Megaphone className="size-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">
                Marketing &amp; communications
              </p>
            </div>
            <ToggleRow
              label="Marketing emails"
              description="Product news, promotions, and tips"
              checked={draft.marketing_opt_in}
              onCheckedChange={(v) => set("marketing_opt_in", v)}
            />
            <Separator />
            <p className="text-xs font-medium text-muted-foreground">
              How we reach you
            </p>
            {COMMUNICATION_CHANNELS.map((c) => (
              <ToggleRow
                key={c.value}
                label={c.label}
                description={c.description}
                checked={draft.communication_prefs[c.value]}
                onCheckedChange={(v) => setChannel(c.value, v)}
              />
            ))}
          </div>

          {/* Save / reset */}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!dirty || busy} onClick={save}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save preferences
            </Button>
            {dirty ? (
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Discard changes
              </Button>
            ) : null}
            {!dirty && !note ? (
              <span className="text-xs text-muted-foreground">
                All changes saved.
              </span>
            ) : null}
          </div>

          {saveError ? <Note tone="error">{saveError}</Note> : null}
          {note ? <Note>{note}</Note> : null}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Consent & permissions (user_metadata.consent) — GDPR/CCPA lawful basis
// ---------------------------------------------------------------------------

/** Client mirror of lib/consent-audit's ConsentAuditEntry (server-only module). */
interface ConsentAuditEntryView {
  id: number
  topic: ConsentTopic
  action: "granted" | "withdrawn"
  previousValue: boolean | null
  newValue: boolean
  source: string
  createdAt: string
}

/** Topic value → display label, derived from the single source of truth. */
const CONSENT_TOPIC_LABELS: Record<ConsentTopic, string> = CONSENT_TOPICS.reduce(
  (acc, t) => {
    acc[t.value] = t.label
    return acc
  },
  {} as Record<ConsentTopic, string>,
)

/**
 * Client-side diff mirroring lib/consent-audit's diffConsent: which topics
 * changed between two consent states. Used to synthesize Demo history entries
 * so the timeline behaves the same way it will once live.
 */
function computeConsentChanges(
  previous: ConsentState,
  next: ConsentState,
): { topic: ConsentTopic; action: "granted" | "withdrawn"; previousValue: boolean; newValue: boolean }[] {
  const changes: { topic: ConsentTopic; action: "granted" | "withdrawn"; previousValue: boolean; newValue: boolean }[] = []
  for (const { value: topic } of CONSENT_TOPICS) {
    if (previous[topic] !== next[topic]) {
      changes.push({
        topic,
        action: next[topic] ? "granted" : "withdrawn",
        previousValue: previous[topic],
        newValue: next[topic],
      })
    }
  }
  return changes
}

/** Read-only timeline of consent changes, newest first. */
function ConsentHistory({
  loading,
  entries,
  live,
}: {
  loading: boolean
  entries: ConsentAuditEntryView[]
  live: boolean
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">Consent history</h4>
        <span className="text-xs text-muted-foreground">
          {live ? "Recorded audit trail" : "Simulated"}
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading history…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No consent changes recorded yet. Grant or withdraw a consent above and
          save to create the first entry.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const granted = e.action === "granted"
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-5 flex-none items-center justify-center rounded-full",
                    granted
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {granted ? <Check className="size-3" /> : <X className="size-3" />}
                </span>
                <div className="min-w-0">
                  <p className="text-foreground">
                    <span className="font-medium">
                      {CONSENT_TOPIC_LABELS[e.topic] ?? e.topic}
                    </span>{" "}
                    {granted ? "granted" : "withdrawn"}
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        This log is append-only — entries are never edited or removed — so it can
        serve as accountability evidence for consent under GDPR/CCPA.
      </p>
    </div>
  )
}

function ConsentSection({ live }: { live: boolean }) {
  // Live: read the user's saved consent from user_metadata.consent. Demo: defaults.
  const { data, error, isLoading, mutate } = useSWR<{
    configured: boolean
    consent: ConsentState
    updatedAt: string | null
  }>(live ? "/api/account/consent" : null, fetcher, {
    onError: (err) =>
      warnManagementApiUnavailable(
        "Consent & permissions",
        ["read:users", "update:users"],
        (err as { status?: number })?.status,
      ),
  })

  const consentError = live ? Boolean(error) : false
  const consent403 = (error as { status?: number } | undefined)?.status === 403

  // Append-only audit trail (Neon-backed when live). Demo keeps a local history.
  const {
    data: auditData,
    isLoading: auditLoading,
    mutate: mutateAudit,
  } = useSWR<{ configured: boolean; entries: ConsentAuditEntryView[] }>(
    live ? "/api/account/consent/audit" : null,
    fetcher,
  )
  const [demoHistory, setDemoHistory] = useState<ConsentAuditEntryView[]>([])

  const [saved, setSaved] = useState<ConsentState>(DEFAULT_CONSENT)
  const [draft, setDraft] = useState<ConsentState>(DEFAULT_CONSENT)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Seed baseline + draft once when live data arrives.
  const loadedKey = live ? (data ? JSON.stringify(data.consent) : null) : "demo"
  const [seededKey, setSeededKey] = useState<string | null>(null)
  if (loadedKey && loadedKey !== seededKey && live && data) {
    setSaved(data.consent)
    setDraft(data.consent)
    setUpdatedAt(data.updatedAt)
    setSeededKey(loadedKey)
  }

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  )

  function set(topic: ConsentTopic, value: boolean) {
    setNote(null)
    setSaveError(null)
    setDraft((prev) => ({ ...prev, [topic]: value }))
  }

  async function save() {
    setSaveError(null)
    setNote(null)
    if (!live) {
      // Synthesize audit entries from the diff so the Demo timeline behaves
      // exactly like the live append-only log.
      const changes = computeConsentChanges(saved, draft)
      if (changes.length > 0) {
        const now = new Date().toISOString()
        setDemoHistory((prev) => [
          ...changes.map((c, i) => ({
            id: Date.now() + i,
            topic: c.topic,
            action: c.action,
            previousValue: c.previousValue,
            newValue: c.newValue,
            source: "account_center",
            createdAt: now,
          })),
          ...prev,
        ])
      }
      setSaved(draft)
      setUpdatedAt(new Date().toISOString())
      setNote("Consent saved. (Simulated — no Management API call.)")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/account/consent", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(json.error ?? "Could not save your consent choices.")
      } else {
        const next = (json.consent ?? draft) as ConsentState
        setSaved(next)
        setDraft(next)
        setUpdatedAt(json.updatedAt ?? new Date().toISOString())
        setNote("Consent saved to your user_metadata.")
        mutate()
        mutateAudit()
      }
    } catch {
      setSaveError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  function withdrawAll() {
    setNote(null)
    setSaveError(null)
    setDraft({ ...DEFAULT_CONSENT })
  }

  const allOff = useMemo(
    () => Object.values(draft).every((v) => v === false),
    [draft],
  )

  return (
    <SectionCard
      icon={<ClipboardCheck className="size-5" />}
      title="Consent &amp; permissions"
      tag={live ? <LiveTag /> : <DemoTag />}
      description="Control how Stanley Black & Decker may use your data. You can grant or withdraw consent at any time."
    >
      {live && consentError ? (
        // Plain English only — the status code and required scopes go to the
        // console via warnManagementApiUnavailable(). Do not add them here.
        <Note tone="error">
          {consent403
            ? "We couldn't load your live consent choices right now. Nothing has changed — please refresh the page in a moment to try again."
            : "Live consent couldn't load right now. Please try again."}
        </Note>
      ) : live && isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your consent choices…</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            {CONSENT_TOPICS.map((t, i) => (
              <div key={t.value}>
                {i > 0 ? <Separator /> : null}
                <ToggleRow
                  label={t.label}
                  description={t.description}
                  checked={draft[t.value]}
                  onCheckedChange={(v) => set(t.value, v)}
                />
              </div>
            ))}
          </div>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Essential processing — securing your account, preventing fraud, and
            fulfilling orders — is required to provide the service and is not
            based on consent, so it isn&apos;t listed here.
          </p>

          {/* Save / withdraw */}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!dirty || busy} onClick={save}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save consent
            </Button>
            <Button
              variant="ghost"
              onClick={withdrawAll}
              disabled={busy || allOff}
            >
              Withdraw all
            </Button>
            {updatedAt ? (
              <span className="text-xs text-muted-foreground">
                Last updated {new Date(updatedAt).toLocaleString()}
              </span>
            ) : !dirty ? (
              <span className="text-xs text-muted-foreground">
                No consent recorded yet.
              </span>
            ) : null}
          </div>

          {saveError ? <Note tone="error">{saveError}</Note> : null}
          {note ? <Note>{note}</Note> : null}

          <ConsentHistory
            live={live}
            loading={live ? auditLoading : false}
            entries={live ? (auditData?.entries ?? []) : demoHistory}
          />
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Sign-in & security: password, MFA, passkeys, connected accounts
// ---------------------------------------------------------------------------
function SecuritySection({
  live,
  connectionLabel,
}: {
  live: boolean
  connectionLabel: string
}) {
  // MFA is a SECOND FACTOR — kept separate from "ways you sign in" below.
  const mfa = useSWR<{ configured: boolean; enabled: boolean; enrollments: { id: string; type: string; status: string }[] }>(
    live ? "/api/account/mfa" : null,
    fetcher,
  )

  // Consolidated "ways you sign in" (linked identities + passkeys).
  const loginMethods = useSWR<{
    configured: boolean
    methods: LoginMethodView[]
    total: number
    removableCount: number
  }>(live ? "/api/account/login-methods" : null, fetcher, {
    onError: (err) =>
      warnManagementApiUnavailable(
        "Sign-in methods",
        ["read:users", "read:authentication_methods"],
        (err as { status?: number })?.status,
      ),
  })

  // Demo-only local state
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [demoMethods, setDemoMethods] = useState<LoginMethodView[]>(DEMO_LOGIN_METHODS)
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [methodError, setMethodError] = useState<string | null>(null)
  const [methodNote, setMethodNote] = useState<string | null>(null)

  // Surface live-fetch failures gracefully instead of crashing or spinning.
  const methodsLoadError = live ? Boolean(loginMethods.error) : false
  const methods403 = (loginMethods.error as { status?: number } | undefined)?.status === 403

  // The unified list + lockout math (always keep at least one way in).
  const methods = live ? loginMethods.data?.methods ?? [] : demoMethods
  const total = methods.length

  // The top-level primary reset resets the SHARED credential, so only show it
  // when the loaded methods actually contain a real shared password credential
  // (connectionKey shared, or an untagged primary password — the shared demo
  // account). A case-3/4-only account has NO shared password, so it must reset
  // through its per-row actions instead of this misleading top-level button. In
  // demo mode the shared reset is preserved unchanged.
  const hasSharedPassword = live ? hasSharedPasswordCredential(methods) : true

  async function removeMfa(id: string) {
    await fetch(`/api/account/mfa?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    mfa.mutate()
  }

  async function forgetMethod(m: LoginMethodView) {
    setMethodError(null)
    setMethodNote(null)
    if (!live) {
      // Demo: drop it from local state (lockout guard still applies in the UI).
      setDemoMethods((prev) => prev.filter((x) => x.key !== m.key))
      setMethodNote(`Removed ${m.label}. (Simulated — no Management API call.)`)
      return
    }
    setForgetting(m.key)
    try {
      const url =
        m.kind === "passkey"
          ? `/api/account/passkeys?id=${encodeURIComponent(m.methodId ?? "")}`
          : `/api/account/identities?provider=${encodeURIComponent(m.provider ?? "")}&user_id=${encodeURIComponent(m.userId ?? "")}`
      const res = await fetch(url, { method: "DELETE" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMethodError(json.error ?? "Could not remove this sign-in method.")
      } else {
        setMethodNote(`Removed ${m.label}.`)
        loginMethods.mutate()
      }
    } catch {
      setMethodError("Network error. Please try again.")
    } finally {
      setForgetting(null)
    }
  }

  return (
    <SectionCard
      icon={<ShieldCheck className="size-5" />}
      title="Sign-in &amp; security"
      tag={live ? <LiveTag /> : <DemoTag />}
      description={
        live
          ? "Manage your real authentication factors via the Management API."
          : "Manage how you authenticate. Wires to Auth0 self-service in production."
      }
    >
      <div className="space-y-4">
        {/* Password — the top-level SHARED credential. Rendered only when the
            account actually has a shared password credential; case-3/4-only
            accounts change through their per-row "Change password" actions below. */}
        {hasSharedPassword ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <KeyRound className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Password</p>
                  <p className="text-xs text-muted-foreground">
                    {connectionLabel === "Email & password"
                      ? "Managed by Auth0"
                      : "No password — you sign in with " + connectionLabel}
                  </p>
                </div>
              </div>
              <ChangePasswordDialog
                live={live}
                target={{
                  selector: { scope: "shared" },
                  label: "Account password",
                  line: "Works with your verified account emails across DeWalt and Stanley sites.",
                }}
                onChanged={() => loginMethods.mutate()}
              />
            </div>
            <Separator />
          </>
        ) : null}

        {/* MFA */}
        <div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Smartphone className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Multi-factor authentication
                </p>
                <p className="text-xs text-muted-foreground">
                  {live
                    ? mfa.error
                      ? "Couldn't load factors"
                      : mfa.data
                        ? mfa.data.enabled
                          ? `${mfa.data.enrollments?.length ?? 0} factor(s) enrolled`
                          : "No factors enrolled yet"
                        : "Loading factors…"
                    : mfaEnabled
                      ? "Enabled (simulated)"
                      : "Add a second factor for extra protection"}
                </p>
              </div>
            </div>
            {live ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startAuthRedirect(buildAuthLoginUrl({ returnTo: "/dev-account-details" }))}
              >
                <Plus className="size-4" />
                Enroll factor
              </Button>
            ) : (
              <Switch
                checked={mfaEnabled}
                onCheckedChange={setMfaEnabled}
                aria-label="Toggle multi-factor authentication"
              />
            )}
          </div>
          {live && mfa.data?.enrollments?.length ? (
            <ul className="mt-3 space-y-2">
              {mfa.data.enrollments.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <Smartphone className="size-4 text-primary" />
                  <span className="flex-1 text-sm text-foreground">{e.type}</span>
                  <span className="text-xs text-muted-foreground">{e.status}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeMfa(e.id)} aria-label="Remove factor">
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <Separator />

        {/* Ways you sign in — passwords, social logins, and passkeys, with
            safe "forget" + lockout protection (you always keep one way in). */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link2 className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Ways you sign in
                </p>
                <p className="text-xs text-muted-foreground">
                  {live && methodsLoadError
                    ? "Couldn't load your sign-in methods"
                    : live && !loginMethods.data
                      ? "Loading your sign-in methods…"
                      : `You can sign in ${total} ${total === 1 ? "way" : "ways"}. Remove the ones you no longer use.`}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={
                live
                  ? () => startAuthRedirect(buildAuthLoginUrl({ returnTo: "/dev-account-details" }))
                  : () => {
                      setMethodNote(null)
                      setMethodError(null)
                      setDemoMethods((prev) =>
                        prev.some((m) => m.key === "passkey:demo")
                          ? prev
                          : [
                              ...prev,
                              {
                                key: "passkey:demo",
                                kind: "passkey",
                                label: "Passkey",
                                detail: "Added today",
                                isPrimary: false,
                                removable: true,
                                methodId: "demo",
                              },
                            ],
                      )
                    }
              }
            >
              <Plus className="size-4" />
              Add a way
            </Button>
          </div>

          {live && methodsLoadError ? (
            // Plain English only — the status code and required scopes go to the
            // console via warnManagementApiUnavailable(). Do not add them here.
            <Note tone="error">
              {methods403
                ? "We couldn't load your live sign-in methods right now. The ways you already sign in aren't affected — please refresh the page in a moment to try again."
                : "Live sign-in methods couldn't load right now. Please try again."}
            </Note>
          ) : methods.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {methods.map((m) => {
                const forgettable = m.removable && total > 1
                // An INDIVIDUAL reset applies to a non-shared (case-3 per-email
                // or case-4 per-brand) password credential backed by a binding.
                // The shared credential keeps the single top-level reset above.
                const individualReset =
                  m.kind === "password" &&
                  m.canReset === true &&
                  Boolean(m.resetBindingId) &&
                  m.connectionKey !== undefined &&
                  m.connectionKey !== "shared"
                return (
                  <li
                    key={m.key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <MethodIcon kind={m.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm text-foreground">
                          {m.label}
                        </span>
                        {m.brand ? (
                          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                            {m.brand === "dewalt" ? "DeWalt" : m.brand === "stanley" ? "Stanley" : m.brand}
                          </span>
                        ) : null}
                      </span>
                      {m.detail ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.detail}
                        </span>
                      ) : null}
                      {m.scope ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.scope}
                        </span>
                      ) : null}
                    </span>
                    {individualReset ? (
                      <ChangePasswordDialog
                        live={live}
                        target={{
                          selector: { bindingId: m.resetBindingId as string },
                          label:
                            m.connectionKey === "per-email"
                              ? `Password for ${m.email ?? "this email"}`
                              : `${m.brand === "dewalt" ? "DeWalt" : m.brand === "stanley" ? "Stanley" : "Brand"} password`,
                          line:
                            m.connectionKey === "per-email"
                              ? `${m.email ?? "This email"} has its own password. Changing it will not affect your other sign-in emails.`
                              : `Works only on ${m.brand === "dewalt" ? "DeWalt" : m.brand === "stanley" ? "Stanley" : "this brand"} sites. Changing it will not affect your other brand password.`,
                          brand:
                            m.connectionKey === "dewalt"
                              ? "dewalt"
                              : m.connectionKey === "stanley"
                                ? "stanley"
                                : undefined,
                        }}
                        onChanged={() => loginMethods.mutate()}
                      />
                    ) : null}
                    {m.isPrimary ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                        title="Your primary sign-in — kept so you can't lock yourself out"
                      >
                        <Check className="size-3.5" />
                        Primary
                      </span>
                    ) : forgettable ? (
                      <ForgetMethodButton
                        method={m}
                        busy={forgetting === m.key}
                        onConfirm={() => forgetMethod(m)}
                      />
                    ) : !individualReset ? (
                      <span
                        className="text-xs text-muted-foreground"
                        title="This is your only remaining way to sign in"
                      >
                        Only method
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : live ? null : (
            <Note>You have no sign-in methods configured.</Note>
          )}

          {methodError ? <Note tone="error">{methodError}</Note> : null}
          {methodNote ? <Note>{methodNote}</Note> : null}

          <p className="mt-2 text-xs text-muted-foreground">
            We always keep at least one way in, so removing a method can&apos;t
            lock you out.{" "}
            {live
              ? "Adding a new method signs you in with it first, then links it to this account."
              : "In production, “Add a way” sends you to Auth0 to register the new method."}
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Organizations & tenants
// ---------------------------------------------------------------------------
function OrganizationsSection({ live }: { live: boolean }) {
  const orgsData = useSWR<{ configured: boolean; organizations: { id: string; name: string; display_name?: string }[] }>(
    live ? "/api/account/organizations" : null,
    fetcher,
    {
      onError: (err) =>
        warnManagementApiUnavailable(
          "Organizations & tenants",
          ["read:organizations"],
          (err as { status?: number })?.status,
        ),
    },
  )
  const orgs403 = (orgsData.error as { status?: number } | undefined)?.status === 403

  // Demo-only local state
  const [orgs, setOrgs] = useState<Org[]>([
    { id: "personal", name: "Personal", kind: "Personal", role: "customer" },
  ])
  const [activeOrg, setActiveOrg] = useState("personal")

  function addOrg() {
    const n = orgs.length
    setOrgs((prev) => [
      ...prev,
      {
        id: `org-${n}`,
        name: n === 1 ? "Pro Desk Membership" : "Acme Contracting LLC",
        kind: "Organization",
        role: n === 1 ? "pro-member" : "buyer",
      },
    ])
  }

  return (
    <SectionCard
      icon={<Building2 className="size-5" />}
      title="Organizations &amp; tenants"
      tag={live ? <LiveTag /> : <DemoTag />}
      description="One identity, many contexts. Maps to Auth0 / Okta Organizations for B2B multi-tenancy."
    >
      {live ? (
        orgsData.error ? (
          // Plain English only — the status code and required scopes go to the
          // console via warnManagementApiUnavailable(). Do not add them here.
          <Note tone="error">
            {orgs403
              ? "We couldn't load your live organizations right now. Please refresh the page in a moment to try again."
              : "Live organizations couldn't load right now. Please try again."}
          </Note>
        ) : orgsData.data ? (
          (orgsData.data.organizations?.length ?? 0) > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {orgsData.data.organizations.map((o) => (
                <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                    <Building2 className="size-5" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold text-foreground">{o.display_name || o.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{o.id}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Note>
              You&apos;re not a member of any organizations yet. When you&apos;re
              added to one — by an administrator or an invitation — it will appear
              here.
            </Note>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Loading organizations…</p>
        )
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {orgs.map((o) => {
              const active = o.id === activeOrg
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setActiveOrg(o.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {o.kind === "Organization" ? <Building2 className="size-5" /> : <User className="size-5" />}
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold text-foreground">{o.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {o.kind} &middot; role: {o.role}
                    </span>
                  </span>
                  {active ? <Check className="size-5 text-primary" /> : null}
                </button>
              )
            })}
          </div>
          <Button variant="ghost" size="sm" className="mt-3" onClick={addOrg} disabled={orgs.length >= 3}>
            <Plus className="size-4" />
            Join organization
          </Button>
        </>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Privacy & data (GDPR)
// ---------------------------------------------------------------------------
function PrivacySection({
  live,
  hardDelete,
  onDeleted,
}: {
  live: boolean
  hardDelete: boolean
  onDeleted: () => void
}) {
  const [exported, setExported] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deletionRequested, setDeletionRequested] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ErasureReceipt | null>(null)

  // Region-aware erasure plan (+ any recorded receipt). Always fetched — the
  // endpoint returns the cascade plan even in Demo so we can preview it.
  const { data: erasure } = useSWR<{
    live: boolean
    plan: ErasurePlan
    retention: { gracePeriodDays: number; slaDays: number }
    webhookConfigured: boolean
    receipt: ErasureReceipt | null
  }>("/api/account/erasure", fetcher)

  const plan = erasure?.plan
  const grace = erasure?.retention.gracePeriodDays ?? 30
  const sla = erasure?.retention.slaDays ?? 30
  // A previously recorded receipt (live) takes precedence over a fresh one.
  const shownReceipt = receipt ?? erasure?.receipt ?? null

  /** Build a display receipt for the Demo path from the fetched plan. */
  function synthesizeReceipt(): ErasureReceipt | null {
    if (!plan) return null
    const now = new Date()
    const addDays = (d: number) =>
      new Date(now.getTime() + d * 86_400_000).toISOString()
    return {
      requestId: `ers_${Math.random().toString(16).slice(2, 10)}`,
      requestedAt: now.toISOString(),
      mode: hardDelete ? "hard" : "soft",
      channel: "account-center",
      subject: "demo",
      region: plan.region,
      tenant: plan.tenant,
      hosting: plan.hosting,
      hostingName: plan.hostingName,
      webhookDispatched: false,
      systems: plan.steps.map((s) => ({
        systemId: s.systemId,
        name: s.name,
        action: s.action,
        status: s.systemId === "auth0-directory" ? "done" : "pending",
      })),
      completeBy: addDays(sla),
      graceUntil: hardDelete ? null : addDays(grace),
    }
  }

  function requestExport() {
    if (live) {
      // Trigger a real download from the export route.
      window.location.href = "/api/account/export"
      setExported(true)
      return
    }
    setExported(true)
  }

  async function confirmDelete() {
    setDeleteError(null)
    if (!live) {
      // Demo: show the simulated receipt/cascade instead of erasing anything.
      setReceipt(synthesizeReceipt())
      setDeletionRequested(true)
      setDeleteConfirm("")
      return
    }
    setDeleting(true)
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      })
      const json = await res.json()
      if (!res.ok) {
        setDeleteError(json.error ?? "Deletion failed.")
        setDeleting(false)
        return
      }
      // Success → surface the erasure receipt briefly, then sign the (now
      // blocked/deleted) user out.
      setReceipt((json.receipt as ErasureReceipt | undefined) ?? null)
      setDeletionRequested(true)
      setDeleting(false)
      setTimeout(() => onDeleted(), 3500)
    } catch {
      setDeleteError("Network error. Please try again.")
      setDeleting(false)
    }
  }

  return (
    <SectionCard
      icon={<ShieldCheck className="size-5" />}
      title="Privacy &amp; data"
      tag={live ? <LiveTag /> : <DemoTag />}
      description="GDPR / CCPA self-service: export your data or exercise your right to be forgotten."
    >
      <div className="space-y-4">
        {/* Export */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Export my data</p>
            <p className="text-xs text-muted-foreground">
              Receive a copy of your profile and activity.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={requestExport} disabled={exported && !live}>
            <Download className="size-4" />
            {live ? "Download JSON" : exported ? "Requested" : "Request export"}
          </Button>
        </div>
        {exported ? (
          <Note>
            {live
              ? "Your account export (profile + organizations) was assembled from the Management API and downloaded as JSON."
              : "Export requested. In production we'd email you a download link (simulated)."}
          </Note>
        ) : null}

        <Separator />

        {/* Erasure cascade preview — what a deletion actually reaches */}
        {plan ? <ErasureCascade plan={plan} sla={sla} webhookConfigured={erasure?.webhookConfigured} /> : null}

        <Separator />

        {/* Right to be forgotten */}
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Right to be forgotten</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {live
                  ? hardDelete
                    ? "This permanently erases your user via the Management API (DELETE /users), then fans the request out to every downstream SBD system. Irreversible."
                    : "This blocks your account, records a full erasure receipt, and dispatches the downstream cascade, then signs you out. Reversible during the grace window."
                  : "Permanently delete your identity and personal data. In production this calls the Auth0 Management API to erase the user and cascades the request across every SBD system below."}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                {hardDelete
                  ? `Cascade completes within ${sla} days. No grace window — the identity is erased immediately.`
                  : `Reversible for ${grace} days, then finalized. Full cascade completes within ${sla} days.`}
              </p>
              {deletionRequested && shownReceipt ? (
                <ErasureReceiptCard receipt={shownReceipt} live={live} />
              ) : deletionRequested ? (
                <Note tone="danger">
                  Deletion requested. Your account is now scheduled for erasure across all systems.
                </Note>
              ) : (
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      />
                    }
                  >
                    <Trash2 className="size-4" />
                    Delete my account
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete your account</DialogTitle>
                      <DialogDescription>
                        {live
                          ? hardDelete
                            ? "This permanently deletes your account and cannot be undone. Type DELETE to confirm."
                            : "This blocks and flags your account for erasure, then signs you out. Type DELETE to confirm."
                          : "This is irreversible. To confirm, type DELETE below. (Simulated — nothing is actually deleted.)"}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                      <Label htmlFor="delete-confirm">Confirmation</Label>
                      <Input
                        id="delete-confirm"
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                        placeholder="DELETE"
                        autoComplete="off"
                      />
                    </div>
                    {deleteError ? <Note tone="error">{deleteError}</Note> : null}
                    <DialogFooter>
                      <DialogClose render={<Button variant="ghost" onClick={() => setDeleteConfirm("")} />}>
                        Cancel
                      </DialogClose>
                      <Button
                        variant="destructive"
                        disabled={deleteConfirm !== "DELETE" || deleting}
                        onClick={confirmDelete}
                      >
                        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        {live && !hardDelete ? "Block & sign out" : "Permanently delete"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

/** Colour-code an erasure action (delete / anonymize / retain-legal). */
function ErasureActionBadge({ action }: { action: ErasureAction }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        action === "delete" && "bg-destructive/10 text-destructive",
        action === "anonymize" && "bg-primary/10 text-primary",
        action === "retain-legal" && "bg-muted text-muted-foreground",
      )}
    >
      {ERASURE_ACTION_LABELS[action]}
    </span>
  )
}

/**
 * Preview of the downstream cascade a deletion reaches, plus the residency line
 * that ties the erasure to the tenant/region that holds the identity.
 */
function ErasureCascade({
  plan,
  sla,
  webhookConfigured,
}: {
  plan: ErasurePlan
  sla: number
  webhookConfigured?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <Network className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Where your erasure reaches</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="size-3.5 shrink-0" />
            {plan.residencyNote}
          </p>

          <ul className="mt-3 space-y-2">
            {plan.steps.map((s) => (
              <li key={s.systemId} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Database className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                    <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {DOWNSTREAM_CATEGORY_LABELS[s.category]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.note}</p>
                </div>
                <ErasureActionBadge action={s.action} />
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted-foreground">
            {webhookConfigured
              ? "A downstream cascade webhook is configured — the request is fanned out to these systems automatically."
              : `The request is recorded for the cascade worker to action. Full erasure completes within ${sla} days.`}
          </p>
        </div>
      </div>
    </div>
  )
}

/** A receipt shown after an erasure request: id, mode, per-system status. */
function ErasureReceiptCard({ receipt, live }: { receipt: ErasureReceipt; live: boolean }) {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null)
  return (
    <div className="mt-3 rounded-lg border border-destructive/30 bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">Erasure requested</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {receipt.requestId}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {receipt.mode === "hard" ? "Permanent erase" : "Reversible soft delete"} in the{" "}
        <span className="font-medium text-foreground">{receipt.tenant}</span> tenant (
        {receipt.hostingName} region).{" "}
        {receipt.graceUntil ? `Reversible until ${fmt(receipt.graceUntil)}. ` : ""}
        Completes by {fmt(receipt.completeBy)}.
      </p>
      <ul className="mt-2 space-y-1">
        {receipt.systems.map((s) => (
          <li key={s.systemId} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{s.name}</span>
            <span
              className={cn(
                "shrink-0 font-medium",
                s.status === "done" && "text-primary",
                s.status === "dispatched" && "text-foreground",
                s.status === "pending" && "text-muted-foreground",
              )}
            >
              {s.status === "done" ? "Done" : s.status === "dispatched" ? "Dispatched" : "Queued"}
            </span>
          </li>
        ))}
      </ul>
      {live ? (
        <p className="mt-2 text-xs text-muted-foreground">Signing you out…</p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Simulated — nothing was actually deleted.</p>
      )}
    </div>
  )
}
