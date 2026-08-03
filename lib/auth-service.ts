// MOCK AUTH SERVICE
// =================
// Every auth operation in this app routes through this single module. Components
// never know they're mocked. To wire a real Auth0 client later, replace the
// bodies of these functions with real SDK calls and keep the exported
// signatures identical — the UI does not need to change.
//
// Each // MOCK marker below indicates simulated behavior (latency, codes,
// tokens) that a real implementation would replace.

import type {
  DecodedToken,
  MethodId,
  Session,
  SessionTokens,
  SignInMetrics,
  SocialProvider,
} from "./types"
import { SBD_CLAIMS } from "./claims"

// MOCK: simulate realistic network latency so loading states feel honest.
export function latency(min = 300, max = 900): Promise<void> {
  const ms = Math.round(min + Math.random() * (max - min))
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// MOCK: deterministic-ish 6-digit code generator. Real impl would email it.
export function generateEmailCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// MOCK: opaque single-use token for magic links.
export function generateLinkToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || "tester"
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || "Tester"
}

// MOCK: derive a stable directory id (MUID) from an email.
export function muidFromEmail(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0
  }
  const hex = hash.toString(16).padStart(8, "0")
  return `muid_${hex}${hex.slice(0, 4)}`
}

function base64url(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj)
  if (typeof window !== "undefined" && "btoa" in window) {
    return window.btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }
  return Buffer.from(json).toString("base64url")
}

// MOCK: build a pair of decoded tokens that mirror an Auth0-style claim set,
// including the namespaced roles and muid claims testers want to inspect.
export function buildTokens(opts: {
  email: string
  name: string
  roles: string[]
  muid: string
  method: MethodId
  provider?: string
}): SessionTokens {
  const now = Math.floor(Date.now() / 1000)
  const sub =
    opts.provider && opts.provider !== "Entra ID"
      ? `${opts.provider.toLowerCase()}|${opts.muid.slice(5, 17)}`
      : `auth0|${opts.muid.slice(5, 17)}`

  const header = { alg: "RS256", typ: "JWT", kid: "sbd_demo_key_01" }

  const idPayload: Record<string, unknown> = {
    iss: "https://login.sbdinc.com/",
    aud: "sbd-storefront-demo",
    sub,
    name: opts.name,
    email: opts.email,
    email_verified: true,
    iat: now,
    exp: now + 3600,
    [SBD_CLAIMS.muid]: opts.muid,
    [SBD_CLAIMS.roles]: opts.roles,
    [SBD_CLAIMS.authMethod]: opts.method,
  }
  if (opts.provider) idPayload[SBD_CLAIMS.idp] = opts.provider

  const accessPayload: Record<string, unknown> = {
    iss: "https://login.sbdinc.com/",
    aud: ["https://api.sbdinc.com"],
    sub,
    scope: "openid profile email read:account",
    iat: now,
    exp: now + 3600,
    [SBD_CLAIMS.muid]: opts.muid,
    [SBD_CLAIMS.roles]: opts.roles,
  }

  const sig = "MOCK_SIGNATURE_not_verified"
  const encode = (p: Record<string, unknown>): DecodedToken => ({
    header,
    payload: p,
    encoded: `${base64url(header)}.${base64url(p)}.${sig}`,
  })

  return { idToken: encode(idPayload), accessToken: encode(accessPayload) }
}

export function buildSession(opts: {
  email: string
  name?: string
  method: MethodId
  provider?: SocialProvider | "Entra ID"
  avatarUrl?: string
  roles?: string[]
  metrics: SignInMetrics
}): Session {
  const name = opts.name ?? nameFromEmail(opts.email)
  const muid = muidFromEmail(opts.email)
  const roles = opts.roles ?? ["customer"]
  const tokens = buildTokens({
    email: opts.email,
    name,
    roles,
    muid,
    method: opts.method,
    provider: opts.provider,
  })
  return {
    name,
    email: opts.email,
    method: opts.method,
    provider: opts.provider,
    avatarUrl: opts.avatarUrl,
    roles,
    muid,
    metrics: opts.metrics,
    tokens,
    signedInAt: Date.now(),
  }
}

// MOCK: detect a corporate SBD email to branch into SSO.
export function isCorporateEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@sbdinc.com")
}

// MOCK: a simple email shape check for inline validation.
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// ---- Password rule validation (Classic password flow) -------------------

export interface PasswordRule {
  id: string
  label: string
  test: (pw: string) => boolean
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { id: "number", label: "One number", test: (p) => /[0-9]/.test(p) },
  {
    id: "special",
    label: "One special character",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
  {
    id: "no-common",
    label: 'No "password"-like words',
    test: (p) => p.length > 0 && !/pass\W?word|qwerty|admin|letmein/i.test(p),
  },
  {
    id: "no-repeat",
    label: "No 3+ repeated characters in a row",
    test: (p) => p.length > 0 && !/(.)\1\1/.test(p),
  },
]

export function passwordRuleState(pw: string): Record<string, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((r) => [r.id, r.test(pw)]))
}

export function allPasswordRulesPass(pw: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(pw))
}
