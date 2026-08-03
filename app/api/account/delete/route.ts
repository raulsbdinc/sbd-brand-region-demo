import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { updateUser, deleteUser } from "@/lib/auth0-management"
import { REGION_COOKIE } from "@/lib/regions"
import {
  buildErasureReceipt,
  type ErasureMode,
  type ErasureReceipt,
} from "@/lib/erasure"

// POST /api/account/delete
// Right-to-be-forgotten. This is the FIRST hop of a real RTBF cascade: it erases
// the Auth0 identity and then fans the request out to every downstream SBD
// system that holds the person's data (see lib/erasure.ts).
//
//   SOFT (default, demo-safe): block the user and tag a full erasure receipt in
//   app_metadata, then the client signs the user out. Reversible during the
//   grace window — appropriate for the SHARED demo tenant where a hard delete
//   would permanently destroy a real test identity.
//
//   HARD (opt-in): if AUTH0_ALLOW_HARD_DELETE === "1", call DELETE
//   /api/v2/users/{id} for a real, irreversible erase.
//
// In BOTH modes we build a region-aware erasure receipt and make a best-effort
// dispatch to the downstream cascade webhook (SBD_ERASURE_WEBHOOK_URL) when it
// is configured, so downstream systems (order history, marketing, support,
// analytics…) can honour the request too.
//
// Requires the client to confirm by typing DELETE (echoed in the body) — the
// route re-checks it server-side so the confirmation can't be bypassed.
export const dynamic = "force-dynamic"

/** Whether a downstream cascade webhook is wired up. */
function erasureWebhookUrl(): string | undefined {
  return process.env.SBD_ERASURE_WEBHOOK_URL || undefined
}

/**
 * Best-effort fan-out to the downstream erasure webhook. Never throws — a failed
 * cascade must not block the identity erasure (which is the legally binding
 * part). Returns whether the dispatch was accepted so the receipt can record it.
 */
async function dispatchCascade(receipt: ErasureReceipt): Promise<boolean> {
  const url = erasureWebhookUrl()
  if (!url) return false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A shared secret lets the receiver verify the call is really from us.
        ...(process.env.SBD_ERASURE_WEBHOOK_SECRET
          ? { "x-sbd-erasure-secret": process.env.SBD_ERASURE_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        type: "account.erasure.requested",
        requestId: receipt.requestId,
        subject: receipt.subject,
        region: receipt.region,
        mode: receipt.mode,
        systems: receipt.systems.map((s) => s.systemId),
        requestedAt: receipt.requestedAt,
        completeBy: receipt.completeBy,
      }),
      cache: "no-store",
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.ok
  } catch (err) {
    console.log(
      "[v0] erasure cascade webhook dispatch failed:",
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: { confirm?: string } = {}
  try {
    body = (await request.json()) as { confirm?: string }
  } catch {
    // empty body is fine; confirmation check below will reject it
  }

  if (body.confirm !== "DELETE") {
    return NextResponse.json(
      { error: 'Type "DELETE" to confirm.' },
      { status: 400 },
    )
  }

  const hardDeleteEnabled = process.env.AUTH0_ALLOW_HARD_DELETE === "1"
  const mode: ErasureMode = hardDeleteEnabled ? "hard" : "soft"

  // Which tenant/region holds this identity (drives residency in the receipt).
  const cookieStore = await cookies()
  const region = cookieStore.get(REGION_COOKIE)?.value ?? null

  try {
    // 1) Fan out to downstream systems first (best-effort, never blocking).
    const provisionalReceipt = buildErasureReceipt({
      subject: guard.user.sub,
      mode,
      channel: "account-center",
      region,
      webhookDispatched: false,
    })
    const webhookDispatched = await dispatchCascade(provisionalReceipt)
    const receipt: ErasureReceipt = { ...provisionalReceipt, webhookDispatched }
    // Recompute downstream step statuses to reflect the actual dispatch result.
    receipt.systems = receipt.systems.map((s) =>
      s.systemId === "auth0-directory"
        ? s
        : { ...s, status: webhookDispatched ? "dispatched" : "pending" },
    )

    // 2) Erase the identity itself.
    if (hardDeleteEnabled) {
      await deleteUser(guard.user.sub)
      return NextResponse.json({
        configured: true,
        mode: "hard",
        deleted: true,
        receipt,
      })
    }

    // Soft delete: block sign-in + record the full erasure receipt so an admin
    // (or the cascade worker) can action and audit it.
    await updateUser(guard.user.sub, {
      blocked: true,
      app_metadata: {
        deletion_requested: true,
        deletion_requested_at: receipt.requestedAt,
        deletion_channel: "account-center",
        erasure: receipt,
      },
    })
    return NextResponse.json({
      configured: true,
      mode: "soft",
      deleted: true,
      receipt,
    })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
