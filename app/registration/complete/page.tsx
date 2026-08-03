import type { Metadata } from "next"
import { RegistrationCompletion } from "@/components/registration-completion"

export const metadata: Metadata = { title: "Registration next steps" }

export default function RegistrationCompletePage() {
  return <RegistrationCompletion />
}
