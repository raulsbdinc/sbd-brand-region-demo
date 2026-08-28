"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AtSign,
  KeyRound,
  Loader2,
  Mails,
  ShieldCheck,
  Layers,
  ArrowLeft,
  Info,
} from "lucide-react"
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
import { ACCOUNT_MODEL_META, type AccountModel } from "@/lib/account-model"

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
        <PerEmailJourney onBack={() => setStep("choose")} />
      ) : (
        <PerBrandJourney
          onBack={() => setStep("choose")}
          brandName={brandName}
          otherBrandName={otherBrandName}
        />
      )}

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium text-primary underline underline-offset-4">
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

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}>
      <ArrowLeft data-icon="inline-start" />
      Change sign-in type
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

/** Minimal client-side sanity check; the server enforces the real policy. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// --- Model 3: different email + password per sign-in ------------------------

function PerEmailJourney({ onBack }: { onBack: () => void }) {
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [primaryPassword, setPrimaryPassword] = useState("")
  const [addSecond, setAddSecond] = useState(false)
  const [secondaryEmail, setSecondaryEmail] = useState("")
  const [secondaryPassword, setSecondaryPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState<NotReady | null>(null)
  const [done, setDone] = useState<{ completionAvailable: boolean } | null>(null)

  const emailsClash =
    addSecond &&
    primaryEmail.length > 0 &&
    secondaryEmail.trim().toLowerCase() === primaryEmail.trim().toLowerCase()

  const canSubmit =
    looksLikeEmail(primaryEmail) &&
    primaryPassword.length >= 8 &&
    (!addSecond ||
      (looksLikeEmail(secondaryEmail) && secondaryPassword.length >= 8 && !emailsClash))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/registration/per-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryEmail,
          primaryPassword,
          ...(addSecond ? { secondaryEmail, secondaryPassword } : {}),
        }),
      })
      const data = await res.json()
      if (res.status === 200 && data?.configured === false) {
        setNotReady({ reason: String(data.reason ?? "not-configured") })
        return
      }
      if (res.status === 201 && data?.status === "created") {
        setDone({ completionAvailable: data.completionAvailable === true })
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
        <SuccessNotice title="Account created">
          Your account is ready. You can sign in with the email and password you
          just set.
        </SuccessNotice>
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

  return (
    <div className="flex flex-col gap-4">
      <BackButton onBack={onBack} />
      <Card>
        <CardHeader>
          <CardTitle>Different email and password</CardTitle>
          <CardDescription>
            Set up your first sign-in. You can add more emails to this one
            account whenever you like.
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

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button onClick={submit} disabled={busy || !canSubmit}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            Create account
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// --- Model 4: same email, a separate password per brand ---------------------

function PerBrandJourney({
  onBack,
  brandName,
  otherBrandName,
}: {
  onBack: () => void
  brandName: string
  otherBrandName: string
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState<NotReady | null>(null)
  const [done, setDone] = useState<"created" | "linked" | null>(null)
  // When the email already owns the OTHER brand, we must prove ownership first.
  const [proof, setProof] = useState<{ options: string[] } | null>(null)

  const canSubmit = looksLikeEmail(email) && password.length >= 8

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
      <SuccessNotice title={done === "created" ? "Account created" : `${brandName} added to your account`}>
        {done === "created"
          ? `Your ${brandName} account is ready. Sign in with the email and password you just set.`
          : `You can now sign in to ${brandName} with your new brand password. Your ${otherBrandName} password is unchanged.`}
      </SuccessNotice>
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
        <CardDescription>
          This email already has a {otherBrandName} account. Confirm you own it
          and we&apos;ll add {brandName} — no duplicate account.
        </CardDescription>
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
