"use client"

import { useState } from "react"
import { KeyRound, RotateCcw, Search, ShieldCheck, UserX } from "lucide-react"

type UserSummary = {
  user_id: string
  email?: string
  name?: string
  blocked: boolean
  deletionRequested: boolean
  deletionRequestedAt: string | null
}

type ApiResult = {
  configured?: boolean
  reason?: string
  error?: string
  restored?: boolean
  alreadyActive?: boolean
  user?: UserSummary
  candidates?: UserSummary[]
}

export default function AdminRestorePage() {
  const [secret, setSecret] = useState("")
  const [identifier, setIdentifier] = useState("")
  const [mode, setMode] = useState<"email" | "userId">("email")
  const [busy, setBusy] = useState<"lookup" | "restore" | null>(null)
  const [result, setResult] = useState<ApiResult | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  async function call(lookup: boolean) {
    setBusy(lookup ? "lookup" : "restore")
    setErrorText(null)
    setResult(null)
    try {
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-secret": secret,
        },
        body: JSON.stringify({
          [mode]: identifier.trim(),
          lookup,
        }),
      })
      const data = (await res.json()) as ApiResult
      if (res.status === 403) {
        setErrorText("The admin secret was not accepted.")
        return
      }
      if (data.configured === false) {
        setErrorText(
          data.reason === "restore-not-configured"
            ? "Restore is not enabled. Set ADMIN_RESTORE_SECRET in the project environment."
            : "The Management API is not configured for this project.",
        )
        return
      }
      if (!res.ok && data.error) {
        setErrorText(data.error)
        setResult(data)
        return
      }
      setResult(data)
    } catch {
      setErrorText("The request failed. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const canSubmit = secret.trim().length > 0 && identifier.trim().length > 0

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/15">
          <RotateCcw className="size-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Account restore
          </h1>
          <p className="text-sm text-muted-foreground">
            Reactivate a soft-deleted account during its grace window.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="space-y-4">
          <Field label="Admin secret" hint="Sent as the x-admin-secret header; never stored.">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="ADMIN_RESTORE_SECRET"
              />
            </div>
          </Field>

          <div className="flex gap-2">
            {(["email", "userId"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  mode === m
                    ? "rounded-lg border border-primary bg-primary/5 px-3 py-1.5 text-sm font-medium text-foreground"
                    : "rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                }
              >
                {m === "email" ? "By email" : "By user id"}
              </button>
            ))}
          </div>

          <Field label={mode === "email" ? "Email address" : "Auth0 user id (sub)"}>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={mode === "email" ? "person@example.com" : "auth0|abc123"}
            />
          </Field>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              disabled={!canSubmit || busy !== null}
              onClick={() => call(true)}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search className="size-4" />
              {busy === "lookup" ? "Looking up…" : "Look up"}
            </button>
            <button
              type="button"
              disabled={!canSubmit || busy !== null}
              onClick={() => call(false)}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="size-4" />
              {busy === "restore" ? "Restoring…" : "Restore account"}
            </button>
          </div>
        </div>
      </div>

      {errorText ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          {errorText}
        </p>
      ) : null}

      {result?.restored ? (
        <Result
          icon={ShieldCheck}
          tone="success"
          title="Account restored"
          user={result.user}
        >
          The account was unblocked and its deletion flags were cleared. The user
          can sign in again.
        </Result>
      ) : null}

      {result?.alreadyActive ? (
        <Result
          icon={ShieldCheck}
          tone="success"
          title="Account is already active"
          user={result.user}
        >
          This account is not blocked and has no pending deletion. No change was
          needed.
        </Result>
      ) : null}

      {result && !result.restored && !result.alreadyActive && result.user ? (
        <Result
          icon={UserX}
          tone="neutral"
          title="Account found"
          user={result.user}
        >
          {result.user.blocked || result.user.deletionRequested
            ? "This account is deactivated. Choose Restore account to reactivate it."
            : "This account is active."}
        </Result>
      ) : null}
    </main>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

function Result({
  icon: Icon,
  tone,
  title,
  user,
  children,
}: {
  icon: typeof ShieldCheck
  tone: "success" | "neutral"
  title: string
  user?: UserSummary
  children: React.ReactNode
}) {
  return (
    <div
      className={
        tone === "success"
          ? "mt-4 rounded-2xl border border-primary/40 bg-primary/5 p-5"
          : "mt-4 rounded-2xl border border-border bg-card p-5"
      }
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
      {user ? (
        <dl className="mt-3 grid gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Email" value={user.email ?? "—"} />
          <Detail label="User id" value={user.user_id} mono />
          <Detail label="Blocked" value={user.blocked ? "Yes" : "No"} />
          {user.deletionRequestedAt ? (
            <Detail
              label="Deletion requested"
              value={new Date(user.deletionRequestedAt).toLocaleString()}
            />
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-foreground" : "font-medium text-foreground"}>
        {value}
      </dd>
    </div>
  )
}
