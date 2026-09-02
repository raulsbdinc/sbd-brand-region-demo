// SHARED PASSWORD-UPDATE EXECUTOR (server-only)
// =============================================
// Executes a resolved {@link PasswordUpdatePlan} so a password write lands on
// EXACTLY one Auth0 database identity and nothing else. This is the IO half of
// the correctness fix proven by a live per-email defect (see the pure planner
// in lib/password-change.ts, `planPasswordUpdate`): a connection-scoped PATCH is
// only unambiguous when the account has ONE identity on that connection, so a
// linked secondary must be updated by its OWN id via unlink -> PATCH -> relink.
//
// Both the signed-in in-site change (app/api/account/password-change) and the
// unauthenticated drawer recovery reset (app/api/recovery/reset) run this same
// executor, so the exact-identity guarantee and the rollback behavior are shared
// verbatim rather than reimplemented per route.

import "server-only"
import { linkIdentity, unlinkIdentity, updateUser } from "@/lib/auth0-management"
import type {
  PasswordUpdatePlan,
  RelinkPasswordUpdatePlan,
} from "@/lib/password-change"

/** Relink body for restoring a temporarily-unlinked secondary identity. */
function relinkBody(plan: RelinkPasswordUpdatePlan) {
  return {
    provider: plan.provider,
    user_id: plan.secondaryUserId,
    ...(plan.connectionId ? { connection_id: plan.connectionId } : {}),
  } as const
}

/**
 * Execute a resolved {@link PasswordUpdatePlan} so the write lands on EXACTLY
 * one database identity.
 *
 * - `direct`: an unambiguous root identity — PATCH it with `{ password,
 *   connection }` (unchanged legacy behavior for shared Models 1-2 and
 *   standalone per-email/brand accounts).
 * - `relink`: a linked secondary — UNLINK it so it becomes a standalone
 *   Management user, PATCH that user's own id (never ambiguous), then RELINK it.
 *   If the PATCH fails we relink first so the account is never left split; if
 *   the relink itself fails we retry once before surfacing the error.
 */
export async function applyPasswordUpdate(
  plan: PasswordUpdatePlan,
  newPassword: string,
): Promise<void> {
  if (plan.mode === "direct") {
    await updateUser(plan.patchUserId, {
      password: newPassword,
      connection: plan.connectionName,
    })
    return
  }

  // relink mode — detach the exact secondary identity so it is standalone.
  await unlinkIdentity(plan.primaryUserId, plan.provider, plan.secondaryUserId)

  try {
    await updateUser(plan.secondaryPatchUserId, {
      password: newPassword,
      connection: plan.connectionName,
    })
  } catch (patchErr) {
    // The password write failed: restore the linkage before surfacing the
    // error so we never leave the account permanently split.
    try {
      await linkIdentity(plan.primaryUserId, relinkBody(plan))
    } catch (restoreErr) {
      console.log(
        "[v0] password-update relink-after-patch-failure failed:",
        restoreErr instanceof Error ? restoreErr.message : "unknown",
      )
    }
    throw patchErr
  }

  // Password changed on the exact identity — now re-attach it. Retry once.
  try {
    await linkIdentity(plan.primaryUserId, relinkBody(plan))
  } catch {
    await linkIdentity(plan.primaryUserId, relinkBody(plan))
  }
}
