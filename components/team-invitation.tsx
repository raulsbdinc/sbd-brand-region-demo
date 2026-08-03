"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import useSWR from "swr"
import { ArrowLeft, BadgeCheck, Send, ShieldCheck, Users } from "lucide-react"
import { useApp } from "@/components/app-providers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Organization { id: string; name: string; display_name?: string }
const fetcher = (url: string) => fetch(url).then((response) => response.json())

export function TeamInvitation() {
  const { authConfigured, session } = useApp()
  const { data } = useSWR(authConfigured ? "/api/account/organizations" : null, fetcher)
  const liveOrganizations: Organization[] = data?.organizations ?? []
  const organizations = liveOrganizations.length ? liveOrganizations : [{ id: "demo-pro-team", name: "pro-team", display_name: "SBD Pro Team" }]
  const live = data?.configured === true && liveOrganizations.length > 0
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "")
  const [email, setEmail] = useState("")
  const [inviterName, setInviterName] = useState(session?.name ?? "")
  const [result, setResult] = useState<{ email: string; live: boolean } | null>(null)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (liveOrganizations.length > 0 && !liveOrganizations.some((organization) => organization.id === organizationId)) {
      setOrganizationId(liveOrganizations[0].id)
    }
  }, [liveOrganizations, organizationId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("")
    if (!/^\S+@\S+\.\S+$/.test(email) || inviterName.trim().length < 2) { setError("Enter a valid invitee email and inviter name."); return }
    setSending(true)
    if (!live) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      setResult({ email, live: false }); setSending(false); return
    }
    const response = await fetch("/api/account/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, email, inviterName }) })
    const body = await response.json()
    setSending(false)
    if (!response.ok) { setError(body.error ?? "The invitation could not be created."); return }
    setResult({ email, live: true })
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Button variant="ghost" className="self-start" nativeButton={false} render={<Link href="/register" />}><ArrowLeft data-icon="inline-start" />Registration journeys</Button>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2"><Badge variant={live ? "default" : "secondary"}>{live ? "Connected to Auth0 Organizations" : "Demo organization"}</Badge><Badge variant="outline">Pro member</Badge></div>
        <h1 className="text-balance text-4xl font-bold tracking-tight">Invite a teammate</h1>
        <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">Assisted onboarding for supplier and dealer teams. The server verifies that the inviter belongs to the selected organization before Auth0 sends anything.</p>
      </div>

      {result ? (
        <Card><CardHeader><div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"><BadgeCheck /></div><CardTitle>{result.live ? "Invitation sent" : "Demo invitation created"}</CardTitle><CardDescription>{result.live ? `Auth0 accepted an invitation request for ${result.email}. Delivery still depends on the tenant and email provider.` : `No invitation was sent. This demo result is shown because a usable organization membership is not available.`}</CardDescription></CardHeader><CardContent><Button onClick={() => { setResult(null); setEmail("") }}>Invite another teammate</Button></CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-5 text-primary" />Organization invitation</CardTitle><CardDescription>Invitation links return through the app and continue into Auth0 Universal Login.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={submit}><FieldGroup>
              <Field><FieldLabel>Team</FieldLabel><Select value={organizationId} onValueChange={(value) => setOrganizationId(value ?? "")}><SelectTrigger><SelectValue placeholder="Select a team" /></SelectTrigger><SelectContent><SelectGroup>{organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.display_name ?? organization.name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>Only teams returned for the signed-in user are accepted server-side.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="invite-email">Invitee email</FieldLabel><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" /></Field>
              <Field><FieldLabel htmlFor="inviter-name">Your display name</FieldLabel><Input id="inviter-name" value={inviterName} onChange={(event) => setInviterName(event.target.value)} placeholder="Alex Morgan" /></Field>
              {error ? <Alert variant="destructive"><AlertTitle>Check the invitation</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
              <Button type="submit" disabled={sending}>{sending ? "Creating invitation…" : "Invite as Pro member"}<Send data-icon="inline-end" /></Button>
            </FieldGroup></form>
          </CardContent>
        </Card>
      )}
      <Alert><ShieldCheck /><AlertTitle>Scoped by membership</AlertTitle><AlertDescription>Arbitrary organization IDs are rejected. Real mode requires Management API scopes to read memberships and create organization invitations.</AlertDescription></Alert>
    </main>
  )
}
