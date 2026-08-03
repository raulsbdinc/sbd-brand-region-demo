import { Suspense } from "react"
import type { Metadata } from "next"
import { InvitationAcceptance } from "@/components/invitation-acceptance"

export const metadata: Metadata = { title: "Accept team invitation" }

export default function InvitationPage() {
  return <Suspense fallback={null}><InvitationAcceptance /></Suspense>
}
