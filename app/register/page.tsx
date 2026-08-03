import type { Metadata } from "next"
import { RegistrationExperience } from "@/components/registration-experience"

export const metadata: Metadata = {
  title: "Registration journeys",
  description: "Explore contextual account registration and invitation-based onboarding.",
}

export default function RegisterPage() {
  return <RegistrationExperience />
}
