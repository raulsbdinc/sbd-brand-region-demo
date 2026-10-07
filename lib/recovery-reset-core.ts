// Recovery reset core: the decision half of POST /api/recovery/reset, free of
// server-only imports so tests drive it with injected provider operations.
// Order is load-bearing: local password preflight → single-use OTP proof →
// target resolution → ONE password write. Nothing is looked up or written
// before the code is consumed.

import { BRANDS } from "./brands.ts"
import {
  mapPasswordUpdateError,
  planPasswordUpdate,
  validateNewPassword,
  type PasswordUpdatePlan,
} from "./password-change.ts"
import type { RecoveryTargetCore } from "./brand-signin-core.ts"
import type { BrandId } from "./types"

export const RECOVERY_NEUTRAL_FAILURE =
  "We couldn't reset your password. Try again, or go back to sign in."

export interface RecoveryResetDeps {
  /** Consume the emailed code. "bad-code" for a wrong/expired code; throw for anything else. */
  verifyCode(email: string, code: string): Promise<"ok" | "bad-code">
  resolveTarget(email: string): Promise<RecoveryTargetCore | null>
  brandNotSetUp(email: string): Promise<boolean>
  applyUpdate(plan: PasswordUpdatePlan, newPassword: string): Promise<void>
}

export interface RecoveryResetInput {
  body: unknown
  hasCreds: boolean
  market: string
  siteBrandName: string
  brandNotSetUpCode: string
  brandNotSetUpMessage: string
}

export interface RecoveryResetResponse {
  status: number
  body: Record<string, unknown>
}

const neutral = (): RecoveryResetResponse => ({
  status: 400,
  body: { error: RECOVERY_NEUTRAL_FAILURE },
})

function normalize(v: unknown): string {
  if (typeof v !== "string") return ""
  const e = v.trim().toLowerCase()
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ""
}

export async function runRecoveryReset(
  input: RecoveryResetInput,
  deps: RecoveryResetDeps,
): Promise<RecoveryResetResponse> {
  const body = (input.body && typeof input.body === "object" ? input.body : null) as
    | Record<string, unknown>
    | null
  if (!body) return { status: 400, body: { error: "Enter the details to continue." } }

  const email = normalize(body.email)
  const code = typeof body.code === "string" ? body.code.trim() : ""
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : ""
  if (!email) return { status: 400, body: { error: "Enter a valid email address." } }
  if (!code) {
    return { status: 400, body: { error: "Enter the verification code we emailed you." } }
  }

  const policy = validateNewPassword(newPassword, input.market, [email])
  if (!policy.ok) {
    return {
      status: 400,
      body: { code: "weak-password", error: "Choose a stronger password.", failures: policy.failures },
    }
  }
  if (!input.hasCreds) return neutral()

  try {
    const proof = await deps.verifyCode(email, code)
    if (proof === "bad-code") {
      return {
        status: 400,
        body: { code: "bad-code", error: "That code isn't right or has expired. Request a new one." },
      }
    }
  } catch {
    return neutral()
  }

  let target: RecoveryTargetCore | null
  try {
    target = await deps.resolveTarget(email)
  } catch {
    return neutral()
  }
  if (!target) {
    const notSetUp = await deps.brandNotSetUp(email).catch(() => false)
    if (notSetUp) {
      return {
        status: 409,
        body: { code: input.brandNotSetUpCode, error: input.brandNotSetUpMessage },
      }
    }
    return neutral()
  }

  try {
    const plan = planPasswordUpdate({
      auth0UserId: target.auth0UserId,
      managementUserId: target.managementUserId,
      isLinkedSecondary: target.isLinkedSecondary,
      connectionName: target.connectionName,
      connectionId: target.connectionId,
    })
    await deps.applyUpdate(plan, newPassword)
  } catch (err) {
    const e = err as { status?: unknown; code?: unknown }
    return {
      status: 400,
      body: {
        error: mapPasswordUpdateError({
          status: typeof e?.status === "number" ? e.status : undefined,
          code: typeof e?.code === "string" ? e.code : undefined,
          message: err instanceof Error ? err.message : undefined,
        }),
      },
    }
  }

  const scope: "per-email" | "brand" | "shared" =
    target.connectionKey === "dewalt" || target.connectionKey === "stanley"
      ? "brand"
      : target.connectionKey === "per-email"
        ? "per-email"
        : "shared"
  const brandName =
    scope === "brand" && target.brand ? BRANDS[target.brand as BrandId].name : undefined

  return {
    status: 200,
    body: {
      ok: true,
      message: "Your password has been updated. Sign in with your new password.",
      credential: { email: target.email, scope, brandName },
    },
  }
}
