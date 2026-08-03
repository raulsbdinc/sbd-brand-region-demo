"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ArrowRight, MailCheck, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { buildAuthLoginUrl, startAuthRedirect } from "@/lib/auth0-connections"

export function InvitationAcceptance() {
  const params = useSearchParams()
  const invitation = params.get("invitation") ?? ""
  const organization = params.get("organization") ?? ""
  const organizationName = params.get("organization_name") ?? "your Pro team"
  const valid = invitation.length > 8 && organization.length > 2
  const loginUrl = useMemo(() => buildAuthLoginUrl({ returnTo: "/welcome", organization, invitation }), [organization, invitation])

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Card>
        <CardHeader className="text-center"><div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground"><MailCheck /></div><CardTitle className="text-3xl">Join {organizationName}</CardTitle><CardDescription>Use your invited email address to sign in or create an account. Auth0 will bind the accepted invitation to the organization.</CardDescription></CardHeader>
        <CardContent>
          <Alert><ShieldCheck /><AlertTitle>Invitation parameters stay on the authentication path</AlertTitle><AlertDescription>The token is forwarded to Universal Login and is never stored by this page.</AlertDescription></Alert>
        </CardContent>
        <CardFooter className="flex justify-center gap-3">
          {valid ? <Button onClick={() => startAuthRedirect(loginUrl)}>Continue securely<ArrowRight data-icon="inline-end" /></Button> : <Button nativeButton={false} render={<Link href="/register/invite" />}>Create a demo invitation</Button>}
        </CardFooter>
      </Card>
      {!valid ? <p className="text-center text-sm text-muted-foreground">This preview has no valid Auth0 invitation parameters. Real email links provide both invitation and organization values.</p> : null}
    </main>
  )
}
