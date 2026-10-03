// Pure request preflight for the per-brand (Model 4) registration routes.
//
// Every proposed NEW brand password is checked against the shared rule from
// lib/password-policy.ts before the route does anything with side effects:
// no Management lookup, no handoff cookie minted or refreshed, no password
// grant against the existing credential, and no one-time code consumed. A weak
// password therefore leaves a valid pending ownership proof exactly as it was.

import { validateRegistrationPassword } from "./password-policy.ts"

export type PreflightRejection = { ok: false; status: 400; error: string }

function weakPasswordError(password: string): string | null {
  const check = validateRegistrationPassword(password)
  return check.ok ? null : `${check.failures[0]}.`
}

export function preflightBrandEntry(
  body: Record<string, unknown>,
): { ok: true; email: string; password: string } | PreflightRejection {
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!email || !password) {
    return { ok: false, status: 400, error: "Enter an email and password." }
  }
  const weak = weakPasswordError(password)
  if (weak) return { ok: false, status: 400, error: weak }
  return { ok: true, email, password }
}

export type BrandProofMethod = "password" | "email-code"

export function preflightBrandProof(body: Record<string, unknown>):
  | {
      ok: true
      method: BrandProofMethod
      newPassword: string
      existingPassword: string
      code: string
    }
  | PreflightRejection {
  const method: BrandProofMethod = body.method === "email-code" ? "email-code" : "password"
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
  const existingPassword =
    typeof body.existingPassword === "string" ? body.existingPassword : ""
  const code = typeof body.code === "string" ? body.code.trim() : ""

  if (!newPassword) {
    return { ok: false, status: 400, error: "Choose a password for this brand." }
  }
  const weak = weakPasswordError(newPassword)
  if (weak) return { ok: false, status: 400, error: weak }
  if (method === "password" && !existingPassword) {
    return { ok: false, status: 400, error: "Enter your existing password." }
  }
  if (method === "email-code" && !code) {
    return { ok: false, status: 400, error: "Enter the code we emailed you." }
  }
  return { ok: true, method, newPassword, existingPassword, code }
}
