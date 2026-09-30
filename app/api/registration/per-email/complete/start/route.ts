// MODEL 3 COMPLETION — STEP 1: send a one-time code to the deferred email
// =======================================================================
// Authenticated. The signed-in Model-3 customer adds the second email they
// skipped at sign-up. We first DRY-RUN the pure planner (market/config/coherence
// /duplicate) so we never email a code for a request that would be rejected,
// then send a one-time code to the address to prove ownership, and stash a
// signed, httpOnly handoff binding {sub, email} so the browser cannot swap the
// address between this step and completion. No credential is created here.

import { NextResponse, type NextRequest } from "next/server"
import { SITE_MARKET } from "@/lib/site"
import { resolveConnectionNames } from "@/lib/credential-model"
import { readBindings } from "@/lib/credential-resolver"
import { planModel3Completion } from "@/lib/account-model"
import { requireAccountUser } from "@/lib/account-guard"
import { getUser } from "@/lib/auth0-management"
import { startEmailPasscode, resolvePasswordlessCreds } from "@/lib/auth0-passwordless"
import { mintJourneyToken, journeyCookieName, journeyCookieOptions } from "@/lib/journey-handoff"
import { perEmailRouteGate } from "@/lib/per-email-route-gate"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const disabled = perEmailRouteGate()
  if (disabled) return disabled
  const guard = await requireAccountUser({ requireManagement: true })
  if (!guard.ok) return guard.response
  const sub = guard.user.sub

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "That request isn't valid." }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim() : ""
  if (!email) return NextResponse.json({ error: "Enter an email address." }, { status: 400 })

  // Load the account's existing bindings to enforce coherence + no-duplicate.
  let existingBindings
  try {
    existingBindings = readBindings(await getUser(sub))
  } catch {
    return NextResponse.json(
      { error: "We couldn't complete that right now. Please try again." },
      { status: 502 },
    )
  }

  // DRY RUN: check every guard EXCEPT ownership (proven at step 2). If this
  // would be rejected, bail now with a neutral message and send no code.
  const dry = planModel3Completion({
    market: SITE_MARKET,
    primaryUserId: sub,
    existingBindings,
    email,
    ownershipVerified: true,
    connectionNames: resolveConnectionNames(),
  })
  if (!dry.ok) {
    const status = dry.reason === "not-configured" || dry.reason === "market-unavailable" ? 400 : 409
    const map: Record<string, string> = {
      "market-unavailable": "That option isn't available here.",
      "invalid-email": "Enter a valid email address.",
      "not-configured": "That option isn't available here.",
      "duplicate-email-credential": "That email already has its own password.",
      "model-conflict": "That email can't be added to this account.",
    }
    return NextResponse.json(
      { error: map[dry.reason] ?? "That email can't be added." },
      { status },
    )
  }

  // Send the one-time code. Collapse any failure to a neutral message so the
  // response never reveals whether the address exists elsewhere.
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) {
    return NextResponse.json({ configured: false, reason: "passwordless-not-configured" }, { status: 200 })
  }
  try {
    await startEmailPasscode(creds, email)
  } catch {
    return NextResponse.json(
      { error: "We couldn't send a code right now. Please try again." },
      { status: 502 },
    )
  }

  const res = NextResponse.json({ status: "code-sent" }, { status: 200 })
  res.cookies.set(
    journeyCookieName("model3-complete"),
    mintJourneyToken("model3-complete", { sub, email }),
    journeyCookieOptions(),
  )
  return res
}
