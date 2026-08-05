"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  Bell,
  Check,
  Code2,
  Fingerprint,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  ShieldAlert,
  Star,
  Trash2,
  User,
} from "lucide-react"
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
import {
  ADDRESS_LOCALITY_ORDER,
  COMMUNICATION_CHANNELS,
  DEFAULT_ADDRESS_COUNTRY,
  DEFAULT_PREFERENCES,
  type Address,
  type AddressType,
  type CommunicationChannel,
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
  title: string
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
export function CustomerProfile({ user }: CustomerProfileProps) {
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

        <SignInSection live={live} />

        <DeleteSection live={live} onClosed={() => logout()} />
      </div>

      {/* Low-key link to the engineer-facing view. */}
      <div className="mt-8 border-t border-border pt-4 text-center">
        <Link
          href="/account"
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
// Email addresses
// ===========================================================================
interface Identity {
  provider: string
  user_id: string
  profileData?: { email?: string }
}

function EmailSection({ live, primaryEmail }: { live: boolean; primaryEmail: string | null }) {
  const { data, error } = useSWR<{
    configured: boolean
    user: { email?: string; identities?: Identity[] }
  }>(live ? "/api/account/profile" : null, fetcher)

  if (error) warnUnavailable("Email addresses", (error as { status?: number }).status)

  const accountEmail = data?.user?.email ?? primaryEmail
  const alternates =
    (data?.user?.identities ?? [])
      .filter((id) => id.provider === "email")
      .map((id) => id.profileData?.email ?? id.user_id)
      .filter((e): e is string => Boolean(e))
      .filter((e) => e.toLowerCase() !== (accountEmail ?? "").toLowerCase()) ?? []

  return (
    <ProfileCard
      icon={<Mail className="size-5" />}
      title="Email addresses"
      description="Where we send order updates and account notices."
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
          {alternates.map((e) => (
            <li
              key={e}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm text-foreground">{e}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Add flow lands in the next update — rendered but not yet active. */}
      <div className="mt-4">
        <Button variant="outline" size="sm" disabled title="Coming soon">
          <Plus className="size-4" />
          Add another email address
        </Button>
      </div>
    </ProfileCard>
  )
}

// ===========================================================================
// Phone numbers
// ===========================================================================
function PhoneSection({ live }: { live: boolean }) {
  const { data, error } = useSWR<{
    configured: boolean
    user: { user_metadata?: { phone_number?: string } }
  }>(live ? "/api/account/profile" : null, fetcher)

  if (error) warnUnavailable("Phone numbers", (error as { status?: number }).status)

  const phone = data?.user?.user_metadata?.phone_number?.trim() || ""

  return (
    <ProfileCard
      icon={<Phone className="size-5" />}
      title="Phone numbers"
      description="Used for delivery updates and time-sensitive alerts."
    >
      {error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : phone ? (
        <ul className="space-y-2">
          <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
            <span className="text-sm font-medium text-foreground">{phone}</span>
          </li>
        </ul>
      ) : (
        <Note>No phone number saved yet.</Note>
      )}

      <div className="mt-4">
        <Button variant="outline" size="sm" disabled title="Coming soon">
          <Plus className="size-4" />
          Add a phone number
        </Button>
      </div>
    </ProfileCard>
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
interface LoginMethodView {
  key: string
  kind: "password" | "social" | "passkey"
  label: string
  detail?: string
  isPrimary: boolean
}

function SignInMethodIcon({ kind }: { kind: LoginMethodView["kind"] }) {
  const Icon = kind === "passkey" ? Fingerprint : kind === "password" ? KeyRound : Code2
  return <Icon className="size-4 text-primary" />
}

function SignInSection({ live }: { live: boolean }) {
  const { data, error } = useSWR<{
    configured: boolean
    methods: LoginMethodView[]
  }>(live ? "/api/account/login-methods" : null, fetcher)

  if (error) warnUnavailable("How you sign in", (error as { status?: number }).status)

  const methods = data?.methods ?? []

  return (
    <ProfileCard
      icon={<KeyRound className="size-5" />}
      title="How you sign in"
      description="The ways you can get into your account."
    >
      {!live || error ? (
        <Note>{UNAVAILABLE_COPY}</Note>
      ) : methods.length === 0 ? (
        <Note>No sign-in methods to show.</Note>
      ) : (
        <ul className="space-y-2">
          {methods.map((m) => (
            <li
              key={m.key}
              className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <SignInMethodIcon kind={m.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{m.label}</span>
                {m.detail ? (
                  <span className="block truncate text-xs text-muted-foreground">{m.detail}</span>
                ) : null}
              </span>
              {m.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button variant="outline" size="sm" disabled title="Coming soon">
          <Plus className="size-4" />
          Add a way to sign in
        </Button>
      </div>
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
