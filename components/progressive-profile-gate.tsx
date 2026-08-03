"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import useSWR from "swr"
import { ArrowRight, CheckCircle2, ShieldCheck, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  EMPTY_PROGRESSIVE_PROFILE,
  type ProgressiveProfileField,
  type ProgressiveProfileState,
  type ProgressiveProfileValues,
  validateProgressiveProfileField,
} from "@/lib/progressive-profile"

interface ProfileResponse {
  configured: boolean
  profile?: ProgressiveProfileState
  error?: string
}

const FIELD_COPY: Record<
  ProgressiveProfileField,
  { label: string; placeholder: string; autoComplete: string; type: string }
> = {
  given_name: {
    label: "Given name",
    placeholder: "Ada",
    autoComplete: "given-name",
    type: "text",
  },
  family_name: {
    label: "Family name",
    placeholder: "Lovelace",
    autoComplete: "family-name",
    type: "text",
  },
  phone_number: {
    label: "Phone number",
    placeholder: "+1 555 123 4567",
    autoComplete: "tel",
    type: "tel",
  },
}

const fetcher = (url: string) =>
  fetch(url).then(async (response) => {
    const json = (await response.json().catch(() => ({}))) as ProfileResponse
    if (!response.ok) throw new Error(json.error ?? "Profile check failed.")
    return json
  })

export function ProgressiveProfileGate({ children }: { children: ReactNode }) {
  const { data, error, mutate, isLoading } = useSWR<ProfileResponse>(
    "/api/account/progressive-profile",
    fetcher,
    { revalidateOnFocus: false },
  )
  const profile = data?.profile
  const [draft, setDraft] = useState<ProgressiveProfileValues>(
    EMPTY_PROGRESSIVE_PROFILE,
  )
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ProgressiveProfileField, string>>
  >({})
  const [requestError, setRequestError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center px-4 py-10 sm:px-6">
        <div className="w-full rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />
          <p className="mt-4 text-sm text-muted-foreground">Preparing your account…</p>
        </div>
      </main>
    )
  }

  if (error || data?.configured === false || !profile?.shouldPrompt) {
    return <>{children}</>
  }

  const missingFields = profile.missing

  async function update(payload: Record<string, string>) {
    setBusy(true)
    setRequestError(null)
    try {
      const response = await fetch("/api/account/progressive-profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = (await response.json().catch(() => ({}))) as ProfileResponse & {
        errors?: Partial<Record<ProgressiveProfileField, string>>
      }
      if (!response.ok) {
        setFieldErrors(json.errors ?? {})
        setRequestError(json.error ?? "We couldn’t save those details.")
        return
      }
      await mutate(json, { revalidate: false })
    } catch {
      setRequestError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors: Partial<Record<ProgressiveProfileField, string>> = {}
    for (const field of missingFields) {
      const validationError = validateProgressiveProfileField(field, draft[field])
      if (validationError) nextErrors[field] = validationError
    }
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    void update(
      Object.fromEntries(missingFields.map((field) => [field, draft[field]])),
    )
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-4 py-10 sm:px-6">
      <section className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="profile-title">
        <div className="border-b border-border bg-muted/40 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <UserRound className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">One quick step</p>
              <h1 id="profile-title" className="mt-1 text-balance text-2xl font-bold tracking-tight">Complete your profile</h1>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
                Add only the details that are missing. This helps SBD personalize support and account recovery.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-5 p-6 sm:p-8" noValidate>
          {missingFields.map((field) => {
            const copy = FIELD_COPY[field]
            const fieldError = fieldErrors[field]
            return (
              <div key={field} className="flex flex-col gap-2">
                <Label htmlFor={`progressive-${field}`}>{copy.label}</Label>
                <Input
                  id={`progressive-${field}`}
                  type={copy.type}
                  inputMode={field === "phone_number" ? "tel" : "text"}
                  autoComplete={copy.autoComplete}
                  placeholder={copy.placeholder}
                  value={draft[field]}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, [field]: event.target.value }))
                    setFieldErrors((current) => ({ ...current, [field]: undefined }))
                    setRequestError(null)
                  }}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? `progressive-${field}-error` : undefined}
                  autoFocus={field === missingFields[0]}
                />
                {fieldError ? (
                  <p id={`progressive-${field}-error`} className="text-sm text-destructive">{fieldError}</p>
                ) : null}
              </div>
            )
          })}

          {requestError ? (
            <p role="alert" className="text-sm text-destructive">{requestError}</p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              Optional and editable anytime in Account.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void update({ action: "dismiss" })}>
                Not now
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <CheckCircle2 data-icon="inline-start" /> : <ArrowRight data-icon="inline-end" />}
                {busy ? "Saving…" : "Save and continue"}
              </Button>
            </div>
          </div>
        </form>
      </section>
    </main>
  )
}
