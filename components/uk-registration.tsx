"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  AtSign,
  KeyRound,
  Loader2,
  LogIn,
  Mails,
  ShieldCheck,
  Layers,
  ArrowLeft,
  Info,
} from "lucide-react"
import { startAuthRedirect } from "@/lib/auth0-connections"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ACCOUNT_MODEL_META, type AccountModel, crossBrandConfirmMessage } from "@/lib/account-model"

interface Props {
  /** Concrete deployment brand name, e.g. "DeWalt". */
  brandName: string
  /** The other brand a per-brand account might also cover, e.g. "Stanley". */
  otherBrandName: string
  /** True when a non-production ?market override is showing this UK UI. */
  overridden: boolean
}

type Step = "choose" | "form"

// A neutral "not configured / not available" state the API returns when the
// deployment's real market isn't UK or Auth0 lacks the case-3/4 connections.
// The UI never fabricates success — it says so plainly.
interface NotReady {
  reason: string
}

export function UkRegistration({ brandName, otherBrandName, overridden }: Props) {
  const [step, setStep] = useState<Step>("choose")
  const [model, setModel] = useState<AccountModel | null>(null)

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
        </span>
        <h1 className="text-balance text-3xl font-bold tracking-tight">
          Create your {brandName} account
        </h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          Choose how you&apos;d like to sign in. You can pick the approach that
          suits how you shop across our brands — we&apos;ll guide you through the
          rest.
        </p>
      </header>

      {overridden ? (
        <Alert>
          <Info />
          <AlertTitle>Preview only</AlertTitle>
          <AlertDescription>
            You&apos;re viewing the UK registration journeys via a preview
            override. This deployment&apos;s real market isn&apos;t UK, so
            submissions will report that the option isn&apos;t available here.
          </AlertDescription>
        </Alert>
      ) : null}

      {step === "choose" ? (
        <ModelChooser
          model={model}
          onModel={setModel}
          onContinue={() => model && setStep("form")}
          brandName={brandName}
          otherBrandName={otherBrandName}
        />
      ) : model === "per-email" ? (
        <PerEmailJourney
          onBack={() => setStep("choose")}
          brandName={brandName}
          otherBrandName={otherBrandName}
        />
      ) : (
        <PerBrandJourney
          onBack={() => setStep("choose")}
          brandName={brandName}
          otherBrandName={otherBrandName}
        />
      )}

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={overridden ? "/sign-in/uk?market=uk" : "/sign-in/uk"}
          className="font-medium text-primary underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </main>
  )
}

// --- Step 1: the accessible account-model choice ----------------------------

function ModelChooser({
  model,
  onModel,
  onContinue,
  brandName,
  otherBrandName,
}: {
  model: AccountModel | null
  onModel: (m: AccountModel) => void
  onContinue: () => void
  brandName: string
  otherBrandName: string
}) {
  const options: { model: AccountModel; icon: typeof Mails; detail: string }[] = [
    {
      model: "per-email",
      icon: Mails,
      detail:
        "Best if different people share the account, or you like keeping separate sign-ins. Each email has its own password and they all belong to one account.",
    },
    {
      model: "per-brand",
      icon: Layers,
      detail: `Best if you shop both ${brandName} and ${otherBrandName} with the same email but want a separate password for each brand.`,
    },
  ]

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-lg font-semibold">
        How do you want to sign in?
      </legend>
      <div role="radiogroup" aria-label="Account model" className="flex flex-col gap-3">
        {options.map(({ model: m, icon: Icon, detail }) => {
          const meta = ACCOUNT_MODEL_META[m]
          const selected = model === m
          return (
            <label
              key={m}
              className={`flex cursor-pointer gap-4 rounded-xl border p-4 transition-colors ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              <input
                type="radio"
                name="account-model"
                value={m}
                checked={selected}
                onChange={() => onModel(m)}
                className="sr-only"
              />
              <span
                className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg ${
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
                aria-hidden="true"
              >
                <Icon className="size-5" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{meta.title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {detail}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <Button className="mt-2 self-start" disabled={!model} onClick={onContinue}>
        Continue
      </Button>
    </fieldset>
  )
}

// --- Shared bits ------------------------------------------------------------

function BackButton({ onBack, label = "Change sign-in type" }: { onBack: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
      <ArrowLeft data-icon="inline-start" />
      {label}
    </Button>
  )
}

function NotReadyNotice({ notReady }: { notReady: NotReady }) {
  return (
    <Alert>
      <Info />
      <AlertTitle>Not available here yet</AlertTitle>
      <AlertDescription>
        This registration option isn&apos;t enabled for this storefront yet
        ({notReady.reason}). Nothing was created.
      </AlertDescription>
    </Alert>
  )
}

function SuccessNotice({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Alert>
      <ShieldCheck />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

// A direct "Sign in now" affordance shown on the success screens. It routes
// through the UK start route pinned to the SAME connection the account was just
// created on (per-email → per-email connection; per-brand → this brand's
// connection) with the email pre-filled — so the just-registered customer never
// lands on the generic /auth/login that would misroute them to the shared
// default and fail. startAuthRedirect handles the preview-iframe breakout.
function DirectSignInButton({
  option,
  email,
  label,
}: {
  option: "per-email" | "brand"
  email: string
  label: string
}) {
  return (
    <Button
      variant="outline"
      className="self-start"
      onClick={() => {
        const params = new URLSearchParams({
          option,
          email: email.trim(),
          returnTo: "/profile",
        })
        startAuthRedirect(`/api/signin/uk?${params.toString()}`)
      }}
    >
      <LogIn data-icon="inline-start" />
      {label}
    </Button>
  )
}

/** Minimal client-side sanity check; the server enforces the real policy. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// --- Model 3: different email + password per sign-in ------------------------

function PerEmailJourney({
  onBack,
  brandName,
  otherBrandName,
}: {
  onBack: () => void
  brandName: string
  otherBrandName: string
}) {
  const [phase, setPhase] = useState<"details" | "verify">("details")
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [primaryPassword, setPrimaryPassword] = useState("")
  const [addSecond, setAddSecond] = useState(false)
  const [secondaryEmail, setSecondaryEmail] = useState("")
  const [secondaryPassword, setSecondaryPassword] = useState("")
  const [notReady, setNotReady] = useState<NotReady | null>(null)
  const [done, setDone] = useState<{ completionAvailable: boolean } | null>(null)
  // The primary email already owns the OTHER UK brand. A per-email account would
  // split one person in two, so we hand off to the cross-brand proof flow: this
  // becomes a second brand password on the SAME account, never a new user.
  const [crossBrand, setCrossBrand] = useState(false)

  const emailsClash =
    addSecond &&
    primaryEmail.length > 0 &&
    secondaryEmail.trim().toLowerCase() === primaryEmail.trim().toLowerCase()

  const canContinue =
    looksLikeEmail(primaryEmail) &&
    primaryPassword.length >= 8 &&
    (!addSecond ||
      (looksLikeEmail(secondaryEmail) && secondaryPassword.length >= 8 && !emailsClash))

  if (notReady) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} />
        <NotReadyNotice notReady={notReady} />
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <SuccessNotice title="Account created">
          Your account is ready. Both email addresses were confirmed, so you can
          sign in with the email and password you just set.
        </SuccessNotice>
        <DirectSignInButton
          option="per-email"
          email={primaryEmail}
          label="Sign in now"
        />
        {done.completionAvailable ? (
          <Card>
            <CardHeader>
              <CardTitle>Add a second sign-in later</CardTitle>
              <CardDescription>
                Want another email to sign in to the same account? You can add
                one any time — we&apos;ll email a code to confirm it&apos;s
                yours.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button render={<Link href="/account/add-email" />}>
                Add another sign-in email
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    )
  }

  if (crossBrand) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} />
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>You already have a {otherBrandName} account</AlertTitle>
          <AlertDescription>
            This email already signs in to {otherBrandName}, so we can&apos;t set
            up a separate email-and-password login for it. Instead, confirm
            it&apos;s you and we&apos;ll add {brandName} as a second brand
            password on your existing account — no duplicate account, and your{" "}
            {otherBrandName} password stays the same.
          </AlertDescription>
        </Alert>
        <PerBrandJourney
          onBack={onBack}
          brandName={brandName}
          otherBrandName={otherBrandName}
          initialEmail={primaryEmail.trim()}
          initialPassword={primaryPassword}
          autoStart
        />
      </div>
    )
  }

  if (phase === "verify") {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={() => setPhase("details")} label="Edit details" />
        <PerEmailVerify
          primaryEmail={primaryEmail.trim()}
          primaryPassword={primaryPassword}
          secondaryEmail={addSecond ? secondaryEmail.trim() : undefined}
          secondaryPassword={addSecond ? secondaryPassword : undefined}
          onNotReady={setNotReady}
          onDone={setDone}
          onCrossBrand={() => setCrossBrand(true)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <Card>
        <CardHeader>
          <CardTitle>Different email and password</CardTitle>
          <CardDescription>
            Set up your first sign-in. We&apos;ll email a one-time code to
            confirm each address is yours before your account is created.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            id="pe-email"
            label="Email"
            icon={AtSign}
            type="email"
            autoComplete="email"
            value={primaryEmail}
            onChange={setPrimaryEmail}
          />
          <Field
            id="pe-password"
            label="Password"
            icon={KeyRound}
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            value={primaryPassword}
            onChange={setPrimaryPassword}
          />

          <label className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={addSecond}
              onChange={(e) => setAddSecond(e.target.checked)}
              className="size-4 accent-primary"
            />
            Add a second sign-in email now (optional)
          </label>

          {addSecond ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
              <Field
                id="pe-email2"
                label="Second email"
                icon={AtSign}
                type="email"
                autoComplete="email"
                value={secondaryEmail}
                onChange={setSecondaryEmail}
              />
              <Field
                id="pe-password2"
                label="Password for the second email"
                icon={KeyRound}
                type="password"
                autoComplete="new-password"
                hint="At least 8 characters. Can differ from your first password."
                value={secondaryPassword}
                onChange={setSecondaryPassword}
              />
              {emailsClash ? (
                <p className="text-sm text-destructive">
                  Use a different address from your first email.
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {addSecond
              ? "Next, we'll confirm both email addresses with a one-time code."
              : "Next, we'll confirm your email address with a one-time code."}
          </p>

          <Button onClick={() => setPhase("verify")} disabled={!canContinue}>
            Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// Model 3 verify: prove ownership of EVERY email with a one-time code, then
// create. Codes are NOT verified one-by-one against a throwaway endpoint —
// they're collected here and submitted together to the create route, which
// CONSUMES each code at the IdP immediately before it creates anything. So
// nothing is minted until every code is consumed in that one request, and a
// code can't be replayed (the IdP single-uses it). An abandoned journey leaves
// no Auth0 identity behind.
type EmailCodeState = { sent: boolean; sending: boolean; code: string }

function PerEmailVerify({
  primaryEmail,
  primaryPassword,
  secondaryEmail,
  secondaryPassword,
  onNotReady,
  onDone,
  onCrossBrand,
}: {
  primaryEmail: string
  primaryPassword: string
  secondaryEmail?: string
  secondaryPassword?: string
  onNotReady: (n: NotReady) => void
  onDone: (d: { completionAvailable: boolean }) => void
  onCrossBrand: () => void
}) {
  const emails = secondaryEmail ? [primaryEmail, secondaryEmail] : [primaryEmail]
  const [states, setStates] = useState<Record<string, EmailCodeState>>(() =>
    Object.fromEntries(emails.map((e) => [e, { sent: false, sending: false, code: "" }])),
  )
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = emails.length
  const allCodesEntered = emails.every((e) => (states[e]?.code ?? "").trim().length > 0)
  const anySent = emails.some((e) => states[e]?.sent)

  function patch(email: string, next: Partial<EmailCodeState>) {
    setStates((prev) => ({ ...prev, [email]: { ...prev[email], ...next } }))
  }

  function handleNotReady(data: { reason?: unknown }) {
    onNotReady({ reason: String(data?.reason ?? "not-configured") })
  }

  async function sendCode(email: string) {
    patch(email, { sending: true })
    setError(null)
    try {
      const res = await fetch("/api/registration/per-email/verify/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryEmail,
          ...(secondaryEmail ? { secondaryEmail } : {}),
          email,
        }),
      })
      const data = await res.json()
      if (res.status === 200 && data?.configured === false) {
        handleNotReady(data)
        return
      }
      if (res.status === 200 && data?.status === "cross-brand-required") {
        onCrossBrand()
        return
      }
      if (res.status === 200 && data?.status === "code-sent") {
        patch(email, { sent: true })
        return
      }
      setError(typeof data?.error === "string" ? data.error : "We couldn't send a code. Please try again.")
    } catch {
      setError("We couldn't send a code. Please try again.")
    } finally {
      patch(email, { sending: false })
    }
  }

  async function createAccount() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/registration/per-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryPassword,
          primaryOtp: (states[primaryEmail]?.code ?? "").trim(),
          ...(secondaryEmail
            ? {
                secondaryPassword,
                secondaryOtp: (states[secondaryEmail]?.code ?? "").trim(),
              }
            : {}),
        }),
      })
      const data = await res.json()
      if (res.status === 200 && data?.configured === false) {
        handleNotReady(data)
        return
      }
      if (res.status === 200 && data?.status === "cross-brand-required") {
        onCrossBrand()
        return
      }
      if (res.status === 201 && data?.status === "created") {
        onDone({ completionAvailable: data.completionAvailable === true })
        return
      }
      // A bad/expired/already-used code (or another failure). The server tells
      // us which emails need a fresh code; because the IdP may have already
      // consumed the good one, we reset the affected codes and re-arm "Send".
      const failed: string[] = Array.isArray(data?.failedEmails)
        ? (data.failedEmails as unknown[]).filter((e): e is string => typeof e === "string")
        : []
      const toReset = data?.needResend ? (failed.length ? failed : emails) : failed
      if (toReset.length) {
        setStates((prev) => {
          const nextState = { ...prev }
          for (const raw of toReset) {
            const key = emails.find((e) => e.toLowerCase() === raw.toLowerCase())
            if (key) nextState[key] = { sent: false, sending: false, code: "" }
          }
          return nextState
        })
      }
      setError(
        typeof data?.error === "string"
          ? data.error
          : "We couldn't finish creating your account. Please try again.",
      )
    } catch {
      setError("We couldn't finish creating your account. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm your email</CardTitle>
        <CardDescription>
          {total > 1
            ? "Confirm you own both addresses. We'll email a one-time code to each; enter both, then we'll create your account."
            : "Confirm you own this address. We'll email a one-time code; enter it, then we'll create your account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {emails.map((email, i) => {
          const st = states[email]
          return (
            <div key={email} className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm">
                <Mails className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium break-all">{email}</span>
                {total > 1 ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {i === 0 ? "First email" : "Second email"}
                  </span>
                ) : null}
              </div>

              {!st?.sent ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => sendCode(email)}
                  disabled={st?.sending || creating}
                >
                  {st?.sending ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Mails data-icon="inline-start" />
                  )}
                  Email me a one-time code
                </Button>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`pe-otp-${i}`}>Enter the 6-digit code</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`pe-otp-${i}`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={st.code}
                      onChange={(e) => patch(email, { code: e.target.value })}
                      className="max-w-40"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => sendCode(email)}
                      disabled={st.sending || creating}
                    >
                      Resend
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Sent to {email}. It expires shortly.</p>
                </div>
              )}
            </div>
          )
        })}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button onClick={createAccount} disabled={creating || !anySent || !allCodesEntered}>
          {creating ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
          {creating ? "Creating account…" : "Confirm and create account"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your account isn&apos;t created until {total > 1 ? "both codes are" : "the code is"} confirmed.
        </p>
      </CardContent>
    </Card>
  )
}

// --- Model 4: same email, a separate password per brand ---------------------

function PerBrandJourney({
  onBack,
  brandName,
  otherBrandName,
  initialEmail = "",
  initialPassword = "",
  autoStart = false,
}: {
  onBack: () => void
  brandName: string
  otherBrandName: string
  /** Seed the email when arriving from another journey (e.g. per-email divert). */
  initialEmail?: string
  /** Seed the new brand password to carry a customer's choice across the divert. */
  initialPassword?: string
  /** Submit once on mount to jump straight to the cross-brand proof step. */
  autoStart?: boolean
}) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState(initialPassword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState<NotReady | null>(null)
  const [done, setDone] = useState<"created" | "linked" | null>(null)
  // When the email already owns the OTHER brand, we must prove ownership first.
  const [proof, setProof] = useState<{ options: string[] } | null>(null)
  const [autoStarted, setAutoStarted] = useState(false)

  const canSubmit = looksLikeEmail(email) && password.length >= 8

  // When diverted from the per-email journey we already have a valid email and
  // password, so kick off the create→proof handshake once without a manual step.
  useEffect(() => {
    if (autoStart && !autoStarted && canSubmit) {
      setAutoStarted(true)
      void submitCreate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, autoStarted, canSubmit])

  async function submitCreate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/registration/brand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (res.status === 200 && data?.configured === false) {
        setNotReady({ reason: String(data.reason ?? "not-configured") })
        return
      }
      if (res.status === 201 && data?.status === "created") {
        setDone("created")
        return
      }
      if (res.status === 200 && data?.status === "proof-required") {
        setProof({ options: Array.isArray(data.proofOptions) ? data.proofOptions : ["password"] })
        return
      }
      setError(typeof data?.error === "string" ? data.error : "We couldn't complete that. Please try again.")
    } catch {
      setError("We couldn't complete that. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (notReady) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} />
        <NotReadyNotice notReady={notReady} />
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <SuccessNotice title={done === "created" ? "Account created" : `${brandName} added to your account`}>
          {done === "created"
            ? `Your ${brandName} account is ready. Sign in with the email and password you just set.`
            : `You can now sign in to ${brandName} with your new brand password. Your ${otherBrandName} password is unchanged.`}
        </SuccessNotice>
        <DirectSignInButton
          option="brand"
          email={email}
          label={`Sign in to ${brandName}`}
        />
      </div>
    )
  }

  if (proof) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} />
        <PerBrandProof
          options={proof.options}
          newPassword={password}
          brandName={brandName}
          otherBrandName={otherBrandName}
          onLinked={() => setDone("linked")}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <Card>
        <CardHeader>
          <CardTitle>Same email, different brand password</CardTitle>
          <CardDescription>
            Set your {brandName} password. If you already shop {otherBrandName}{" "}
            with this email, we&apos;ll first confirm it&apos;s you, then add{" "}
            {brandName} to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            id="pb-email"
            label="Email"
            icon={AtSign}
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />
          <Field
            id="pb-password"
            label={`${brandName} password`}
            icon={KeyRound}
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            value={password}
            onChange={setPassword}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button onClick={submitCreate} disabled={busy || !canSubmit}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// Model 4 proof: the email already owns the other brand. Prove ownership with
// its password OR a one-time email code, then the server links this brand with
// the new-brand password captured on the previous step.
function PerBrandProof({
  options,
  newPassword,
  brandName,
  otherBrandName,
  onLinked,
}: {
  options: string[]
  newPassword: string
  brandName: string
  otherBrandName: string
  onLinked: () => void
}) {
  const canCode = options.includes("email-code")
  const [tab, setTab] = useState<"password" | "email-code">("password")
  const [existingPassword, setExistingPassword] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode() {
    setSending(true)
    setError(null)
    try {
      await fetch("/api/registration/brand/proof/start", { method: "POST" })
      setCodeSent(true)
    } catch {
      setError("We couldn't start that. Please try again.")
    } finally {
      setSending(false)
    }
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/registration/brand/proof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          tab === "password"
            ? { method: "password", existingPassword, newPassword }
            : { method: "email-code", code, newPassword },
        ),
      })
      const data = await res.json()
      if (res.status === 201 && data?.status === "linked") {
        onLinked()
        return
      }
      setError(typeof data?.error === "string" ? data.error : "We couldn't verify that. Please try again.")
    } catch {
      setError("We couldn't verify that. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm it&apos;s you</CardTitle>
        <CardDescription>{crossBrandConfirmMessage(brandName, otherBrandName)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "password" | "email-code")
            setError(null)
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="password" className="flex-1">
              <KeyRound data-icon="inline-start" />
              Password
            </TabsTrigger>
            <TabsTrigger value="email-code" className="flex-1" disabled={!canCode}>
              <Mails data-icon="inline-start" />
              Email code
            </TabsTrigger>
          </TabsList>

          <TabsContent value="password" className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pb-existing">Your {otherBrandName} password</Label>
              <Input
                id="pb-existing"
                type="password"
                autoComplete="current-password"
                value={existingPassword}
                onChange={(e) => setExistingPassword(e.target.value)}
              />
            </div>
            <Button onClick={submit} disabled={busy || !existingPassword}>
              {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              Confirm and add {brandName}
            </Button>
          </TabsContent>

          <TabsContent value="email-code" className="mt-4 flex flex-col gap-3">
            {!codeSent ? (
              <Button variant="outline" onClick={sendCode} disabled={sending || !canCode}>
                {sending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Mails data-icon="inline-start" />}
                Email me a one-time code
              </Button>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pb-code">Enter the 6-digit code</Label>
                  <Input
                    id="pb-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={submit} disabled={busy || !code} className="flex-1">
                    {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                    Confirm and add {brandName}
                  </Button>
                  <Button variant="ghost" onClick={sendCode} disabled={sending}>
                    Resend
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

// --- A labeled input with a leading icon and optional hint ------------------

function Field({
  id,
  label,
  icon: Icon,
  hint,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: string
  label: string
  icon: typeof AtSign
  hint?: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          type={type}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9"
        />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
