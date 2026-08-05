export type RegistrationEntryPoint = "newsletter" | "product"

export interface RegistrationConfig {
  id: RegistrationEntryPoint
  eyebrow: string
  title: string
  description: string
  submitLabel: string
  completionTitle: string
  completionDescription: string
  nextLabel: string
  nextHref: string
}

export const LEGAL_VERSIONS = {
  terms: "2026-07-13",
  privacy: "2026-07-13",
} as const

export const REGISTRATION_CONFIG: Record<RegistrationEntryPoint, RegistrationConfig> = {
  newsletter: {
    id: "newsletter",
    eyebrow: "Stay informed",
    title: "Newsletter signup",
    description: "Create one SBD account and choose whether to receive product news, how-to content, and offers.",
    submitLabel: "Create account & continue",
    completionTitle: "Your account journey is ready",
    completionDescription: "Your identity step is complete. The newsletter handoff is represented in this POC and is not yet connected to a marketing platform.",
    nextLabel: "Manage communication preferences",
    nextHref: "/profile",
  },
  product: {
    id: "product",
    eyebrow: "Protect your purchase",
    title: "Register a product",
    description: "Start with the product context, then create or reuse one SBD account without entering credentials in this app.",
    submitLabel: "Create account & continue",
    completionTitle: "Continue your product registration",
    completionDescription: "Your identity step is complete. Product details are preserved only for this browser session; no product system write is claimed.",
    nextLabel: "Continue to account",
    nextHref: "/profile",
  },
}

export interface PendingRegistration {
  entryPoint: RegistrationEntryPoint
  email: string
  modelNumber?: string
  serialNumber?: string
  marketingConsent: boolean
  acceptedAt: string
  legalVersions: typeof LEGAL_VERSIONS
}

export const REGISTRATION_STORAGE_KEY = "sbd_pending_registration"

export function isRegistrationEntryPoint(value: unknown): value is RegistrationEntryPoint {
  return value === "newsletter" || value === "product"
}

export function sanitizePendingRegistration(value: unknown): PendingRegistration | null {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  if (!isRegistrationEntryPoint(input.entryPoint)) return null
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : ""
  if (!/^\S+@\S+\.\S+$/.test(email)) return null
  return {
    entryPoint: input.entryPoint,
    email,
    ...(typeof input.modelNumber === "string" && input.modelNumber.trim()
      ? { modelNumber: input.modelNumber.trim().slice(0, 80) }
      : {}),
    ...(typeof input.serialNumber === "string" && input.serialNumber.trim()
      ? { serialNumber: input.serialNumber.trim().slice(0, 80) }
      : {}),
    marketingConsent: input.marketingConsent === true,
    acceptedAt:
      typeof input.acceptedAt === "string" && !Number.isNaN(Date.parse(input.acceptedAt))
        ? input.acceptedAt
        : new Date().toISOString(),
    legalVersions: LEGAL_VERSIONS,
  }
}
