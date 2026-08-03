import "server-only"

import { createHash } from "node:crypto"

export type RecoveryIntent = "password" | "account"

export const GENERIC_RECOVERY_MESSAGE =
  "If an eligible account uses that email, recovery instructions are on the way."

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 4
const attempts = new Map<string, { count: number; resetAt: number }>()

export function normalizeRecoveryEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null
  return email
}

export function normalizeRecoveryIntent(value: unknown): RecoveryIntent {
  return value === "account" ? "account" : "password"
}

export function maskedEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!local || !domain) return "your email address"
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${"•".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`
}

export function recoveryThrottleKey(email: string, request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const address = forwarded || request.headers.get("x-real-ip") || "unknown"
  return createHash("sha256").update(`${email}|${address}`).digest("hex")
}

export function isRecoveryThrottled(key: string): boolean {
  const now = Date.now()
  const current = attempts.get(key)
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  current.count += 1
  return current.count > MAX_ATTEMPTS
}
