import type { MethodId } from "./types"
import { isPasswordlessLive } from "./auth0-connections"
import {
  Fingerprint,
  Mail,
  Hash,
  KeyRound,
  Code2,
  Building2,
  QrCode,
  type LucideIcon,
} from "lucide-react"

export interface MethodMeta {
  id: MethodId
  /** Short name of the method. */
  name: string
  /** One factual line stating what the method does. */
  description: string
  /** Short tag stating what the tester needs to complete it. */
  tag: string
  /** Whether this card is featured on the picker. */
  featured?: boolean
  /** Whether this method performs a REAL Auth0 login (vs. a simulation). */
  live?: boolean
  icon: LucideIcon
  // Comparison data (/journeys):
  /** Number of discrete steps/screens in the flow. */
  steps: number
  /** Approximate taps/keystrokes to complete. */
  taps: string
  /** Typical time-to-signed-in. */
  time: string
  /** What the tester needs on hand. */
  needs: string
  /** One factual security note. */
  security: string
}

export const METHODS: MethodMeta[] = [
  {
    id: "passkey",
    name: "Passkey",
    description: "Sign in with this device's biometrics (face or fingerprint). No password.",
    tag: "Passwordless",
    featured: true,
    icon: Fingerprint,
    steps: 2,
    taps: "2 taps",
    time: "~4s",
    needs: "A device with a registered passkey",
    security: "No shared secret is sent; a passkey cannot be phished or reused across sites.",
  },
  {
    id: "magic-link",
    name: "Magic link",
    description: "Sign in by opening a one-time link sent to your email.",
    tag: "Needs email inbox",
    // Promoted to real Auth0 passwordless email, gated by the tenant flag.
    live: isPasswordlessLive(),
    icon: Mail,
    steps: 3,
    taps: "3 taps + typing email",
    time: "~20s",
    needs: "Access to the email inbox",
    security: "The link is single-use and stops working after it is opened once.",
  },
  {
    id: "email-code",
    name: "Email code",
    description: "Sign in with a 6-digit code sent to your email.",
    tag: "Needs email inbox",
    // Promoted to real Auth0 passwordless email, gated by the tenant flag.
    live: isPasswordlessLive(),
    icon: Hash,
    steps: 3,
    taps: "6 digits + typing email",
    time: "~25s",
    needs: "Access to the email inbox",
    security: "The code is one-time and expires after it is used.",
  },
  {
    id: "password",
    name: "Classic password",
    description: "Sign in with your email and password on the secure Auth0 / Okta page.",
    tag: "Password",
    live: true,
    icon: KeyRound,
    steps: 2,
    taps: "Continue + password",
    time: "~30s",
    needs: "A remembered password",
    security: "Credentials are entered on the hosted identity provider, never in this app.",
  },
  {
    id: "social",
    name: "Continue with a social provider",
    description:
      "Sign in with Google, Apple, Microsoft, Facebook, GitHub, LinkedIn, or X — brokered through Auth0 / Okta.",
    tag: "External provider",
    live: true,
    icon: Code2,
    steps: 3,
    taps: "2–3 taps",
    time: "~10s",
    needs: "An existing account with a supported provider",
    security: "Authentication is delegated to the identity provider; SBD stores no password.",
  },
  {
    id: "sso",
    name: "SBD employee SSO",
    description: "Sign in with an SBD work account via Entra ID.",
    tag: "Work account",
    icon: Building2,
    steps: 3,
    taps: "Redirect + work sign-in",
    time: "~15s",
    needs: "An @sbdinc.com work account",
    security: "Access is governed by the corporate Entra ID directory and its policies.",
  },
  {
    id: "qr",
    name: "QR invite",
    description: "Scan a counter-issued QR code to set up an account with a preassigned role.",
    tag: "Needs QR scan",
    icon: QrCode,
    steps: 3,
    taps: "Scan + set credentials",
    time: "~30s",
    needs: "A QR code issued at a counter",
    security: "The invite carries a preassigned role and can be used only once.",
  },
]

export function getMethod(id: MethodId): MethodMeta {
  return METHODS.find((m) => m.id === id) as MethodMeta
}
