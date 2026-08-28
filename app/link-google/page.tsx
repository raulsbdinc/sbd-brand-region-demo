import type { Metadata } from "next"
import { LinkGoogleProof } from "@/components/link-google-proof"

export const metadata: Metadata = {
  title: "Connect Google",
  description: "Confirm it's you to connect Google to your existing account.",
}

// Ownership-proof step of the cold-Google reconcile journey. Reached only via a
// server redirect from /api/signin/google/reconcile, which sets the signed
// handoff cookie the proof endpoints read. Direct visits show a neutral
// "nothing to confirm" state.
export const dynamic = "force-dynamic"

export default function LinkGooglePage() {
  return <LinkGoogleProof />
}
