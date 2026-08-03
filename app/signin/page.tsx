import type { Metadata } from "next"
import { SignInExperience } from "@/components/signin-experience"

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in or create your account to track orders, register tools, and unlock pro pricing.",
}

export default function SignInPage() {
  return <SignInExperience />
}
