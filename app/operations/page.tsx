import type { Metadata } from "next"
import { OperationsDashboard } from "@/components/operations-dashboard"

export const metadata: Metadata = {
  title: "CIAM Operations",
  description: "A privacy-safe synthetic operations dashboard for authentication health, registration, verification, MFA, and threat signals.",
}

export default function OperationsPage() {
  return <OperationsDashboard />
}
