"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { ArrowRight, Check, Mail, PackageCheck, ShieldCheck, Users } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildAuthLoginUrl, startAuthRedirect } from "@/lib/auth0-connections"
import {
  LEGAL_VERSIONS,
  REGISTRATION_CONFIG,
  REGISTRATION_STORAGE_KEY,
  type RegistrationEntryPoint,
} from "@/lib/registration"

export function RegistrationExperience() {
  const { authConfigured } = useApp()
  const [entryPoint, setEntryPoint] = useState<RegistrationEntryPoint>("newsletter")
  const [email, setEmail] = useState("")
  const [modelNumber, setModelNumber] = useState("")
  const [serialNumber, setSerialNumber] = useState("")
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const config = REGISTRATION_CONFIG[entryPoint]

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = "Enter a valid email address."
    if (entryPoint === "product" && modelNumber.trim().length < 3) {
      nextErrors.modelNumber = "Enter the model number from your product label."
    }
    if (!legalAccepted) nextErrors.legal = "Accept the Terms and Privacy Notice to continue."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    sessionStorage.setItem(
      REGISTRATION_STORAGE_KEY,
      JSON.stringify({
        entryPoint,
        email: email.trim().toLowerCase(),
        ...(entryPoint === "product" ? { modelNumber, serialNumber } : {}),
        marketingConsent,
        acceptedAt: new Date().toISOString(),
        legalVersions: LEGAL_VERSIONS,
      }),
    )

    const returnTo = "/registration/complete"
    if (authConfigured) {
      startAuthRedirect(
        buildAuthLoginUrl({ returnTo, loginHint: email.trim(), screenHint: "signup" }),
      )
    } else {
      window.location.href = returnTo
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 lg:py-16">
      <section className="grid items-start gap-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col gap-6 lg:sticky lg:top-24">
          <div className="flex flex-col gap-3">
            <span className="text-sm font-semibold uppercase tracking-widest text-primary">Contextual registration</span>
            <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">One identity. The right start for every journey.</h1>
            <p className="max-w-xl text-pretty leading-relaxed text-muted-foreground">
              Newsletter and product registration begin with different context, then converge on the same secure Auth0 account experience.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              [ShieldCheck, "Credentials stay in Universal Login"],
              [Check, "Versioned legal acceptance"],
              [Users, "Progressive profile after sign-up"],
            ].map(([Icon, label]) => {
              const FeatureIcon = Icon as typeof ShieldCheck
              return (
                <div key={label as string} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm font-medium">
                  <FeatureIcon className="size-5 text-primary" aria-hidden="true" />
                  {label as string}
                </div>
              )
            })}
          </div>
        </div>

        <Card className="overflow-hidden shadow-sm">
          <CardHeader className="border-b bg-muted/40">
            <CardTitle>Choose an entry point</CardTitle>
            <CardDescription>The form adapts its fields, validation, consent, and next task.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Tabs value={entryPoint} onValueChange={(value) => setEntryPoint(value as RegistrationEntryPoint)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="newsletter"><Mail /> Newsletter</TabsTrigger>
                <TabsTrigger value="product"><PackageCheck /> Product</TabsTrigger>
              </TabsList>
              <TabsContent value={entryPoint} className="pt-6">
                <form onSubmit={submit} noValidate>
                  <FieldGroup>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-primary">{config.eyebrow}</span>
                      <h2 className="text-2xl font-bold">{config.title}</h2>
                      <p className="text-sm leading-relaxed text-muted-foreground">{config.description}</p>
                    </div>
                    <Field data-invalid={Boolean(errors.email)}>
                      <FieldLabel htmlFor="registration-email">Email address</FieldLabel>
                      <Input id="registration-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} placeholder="you@example.com" />
                      {errors.email ? <FieldDescription className="text-destructive">{errors.email}</FieldDescription> : <FieldDescription>Used as your account identifier and prefilled in Universal Login.</FieldDescription>}
                    </Field>

                    {entryPoint === "product" ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field data-invalid={Boolean(errors.modelNumber)}>
                          <FieldLabel htmlFor="model-number">Model number</FieldLabel>
                          <Input id="model-number" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} aria-invalid={Boolean(errors.modelNumber)} placeholder="DCD999" />
                          {errors.modelNumber ? <FieldDescription className="text-destructive">{errors.modelNumber}</FieldDescription> : null}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="serial-number">Serial number <span className="text-muted-foreground">(optional)</span></FieldLabel>
                          <Input id="serial-number" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="From product label" />
                        </Field>
                      </div>
                    ) : null}

                    <Field orientation="horizontal">
                      <Checkbox id="marketing-consent" checked={marketingConsent} onCheckedChange={(checked) => setMarketingConsent(checked === true)} />
                      <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="marketing-consent">{entryPoint === "newsletter" ? "Send me product news, how-to content, and offers" : "Send me product support tips and relevant updates"}</FieldLabel>
                        <FieldDescription>Optional. You can change this later in Account preferences.</FieldDescription>
                      </div>
                    </Field>

                    <Field orientation="horizontal" data-invalid={Boolean(errors.legal)}>
                      <Checkbox id="legal-consent" checked={legalAccepted} onCheckedChange={(checked) => setLegalAccepted(checked === true)} aria-invalid={Boolean(errors.legal)} />
                      <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="legal-consent">I accept the Terms and acknowledge the Privacy Notice</FieldLabel>
                        <FieldDescription className={errors.legal ? "text-destructive" : undefined}>{errors.legal ?? `Required · Terms ${LEGAL_VERSIONS.terms} · Privacy ${LEGAL_VERSIONS.privacy}`}</FieldDescription>
                      </div>
                    </Field>

                    <Button type="submit" size="lg" className="w-full">
                      {config.submitLabel}<ArrowRight data-icon="inline-end" />
                    </Button>
                    <p className="text-center text-xs leading-relaxed text-muted-foreground">
                      {authConfigured ? "Live: continues to Auth0 Universal Login." : "Demo: shows the complete handoff without contacting Auth0."}
                    </p>
                  </FieldGroup>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Invitation-based registration for Pro teams</CardTitle>
          <CardDescription>A supplier or dealer team admin can invite a teammate into an organization-scoped account journey.</CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-wrap gap-3">
          <Button nativeButton={false} render={<Link href="/register/invite" />}>Invite a teammate<ArrowRight data-icon="inline-end" /></Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/invitation" />}>Preview acceptance entry point</Button>
        </CardFooter>
      </Card>
    </main>
  )
}
