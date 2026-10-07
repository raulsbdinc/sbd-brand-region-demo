// POST /api/signin/passcode/start  { email }
// ===========================================
// Server-side entry point for passcode sign-in. It resolves, entirely on the
// server, whether the address may receive a code on this storefront, sends it
// the matching way, and stashes the decision in a short-lived httpOnly handoff
// cookie.
//
// Brand-scoped storefronts (CIAM-20) stop BEFORE any code is sent and before
// any handoff is minted when the email has no account for this brand, and
// report a failed lookup or send truthfully:
//   200 {ok:true}                         code sent, go enter it
//   404 {code:"not-registered", error}    no account for this brand: sign up
//   409 {code:"conflict", error}          more than one customer claims it
//   429 {code:"throttled", error}         the provider throttled the send
//   503 {code:"provider-unavailable", error}  lookup or send failed or timed out
// Only the 200 sets a handoff cookie. No other response sends mail, creates a
// session, or enrolls anything.

import { NextResponse, type NextRequest } from "next/server"
import { resolvePasswordlessCreds, startEmailPasscode } from "@/lib/auth0-passwordless"
import {
  resolvePasscodeFlow,
  startDatabaseChallenge,
} from "@/lib/auth0-passcode-signin"
import {
  resolveSigninCredential,
  snapshotPasswordlessSubsFor,
} from "@/lib/credential-resolver"
import { planPasscodeStart } from "@/lib/passcode-start-plan"
import {
  PASSCODE_CONFLICT_MESSAGE,
  PASSCODE_NOT_REGISTERED_MESSAGE,
  PASSCODE_SEND_TIMEOUT_MS,
  PASSCODE_THROTTLED_MESSAGE,
  PASSCODE_UNAVAILABLE_MESSAGE,
  gateBrandPasscodeStart,
  passcodeSendFailure,
} from "@/lib/passcode-start-outcome"
import { INTERACTIVE_LOOKUP_BUDGET_MS } from "@/lib/password-grant-core"
import { brandAccessEnforced, brandPasscodeUsesMailboxProof } from "@/lib/brand-access"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import {
  HANDOFF_COOKIE_NAME,
  HANDOFF_TTL_SECONDS,
  encodeHandoff,
  handoffKey,
} from "@/lib/passcode-handoff"
import { carryForwardProofSnapshot } from "@/lib/ownership-otp-proof"

export const runtime = "nodejs"

function generic(): NextResponse {
  return NextResponse.json({ ok: true })
}

function refusal(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ code, error }, { status })
}

function unavailable(): NextResponse {
  return refusal(503, "provider-unavailable", PASSCODE_UNAVAILABLE_MESSAGE)
}

export async function POST(request: NextRequest) {
  let email = ""
  try {
    const body = await request.json()
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  } catch {
    return generic()
  }
  if (!email) return generic()

  const brandScoped = brandAccessEnforced(SITE_MARKET)
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) return brandScoped ? unavailable() : generic()

  const resolution = await resolveSigninCredential(email, SITE_BRAND, {
    deadlineAt: Date.now() + INTERACTIVE_LOOKUP_BUDGET_MS,
  }).catch(() => ({ kind: "unavailable" }) as const)

  // CIAM-20: decide before ANY send. Another brand's enrollment, the wrong
  // region (a different tenant finds nothing) and a never-registered email all
  // stop here. A failed lookup is reported as unavailable, never as
  // "not registered" and never as "code sent".
  if (brandScoped) {
    const gate = gateBrandPasscodeStart({
      resolutionKind: resolution.kind,
      resolvedConnectionKey: resolution.kind === "resolved" ? resolution.connectionKey : undefined,
      siteBrand: SITE_BRAND,
    })
    if (gate === "unavailable") return unavailable()
    if (gate === "conflict") return refusal(409, "conflict", PASSCODE_CONFLICT_MESSAGE)
    if (gate === "not-registered") {
      return refusal(404, "not-registered", PASSCODE_NOT_REGISTERED_MESSAGE)
    }
  }

  // A per-brand binding only REFINES an already-database challenge; it never
  // promotes a passwordless resolution into a database challenge the address
  // can't satisfy.
  const baseFlow = await resolvePasscodeFlow(email)
  const ownsSiteBrand =
    resolution.kind === "resolved" &&
    (!brandScoped || resolution.connectionKey === SITE_BRAND)
  const { flow, dbConnectionName, permitsChallenge } = planPasscodeStart({
    baseFlow,
    resolutionKind: ownsSiteBrand ? "resolved" : resolution.kind === "resolved" ? "shared-default" : resolution.kind,
    resolvedConnectionName:
      ownsSiteBrand && resolution.kind === "resolved" ? resolution.connectionName : undefined,
    brandScoped,
  })

  // Neither tenant delivers native database OTP on the brand connections, so a
  // brand-enrolled customer's code goes out on the passwordless email
  // connection, to the email actually entered, as mailbox proof. Verify
  // consumes it and re-resolves the one brand-enrolled canonical (exact email
  // or verified alias of that same customer).
  const brandProof =
    brandPasscodeUsesMailboxProof(SITE_MARKET) &&
    brandScoped &&
    ownsSiteBrand &&
    resolution.kind === "resolved"

  if (brandScoped && !brandProof && !permitsChallenge) return unavailable()

  // Recorded BEFORE the challenge is sent, so verify can tell a stub minted by
  // THIS challenge from any pre-existing email-only account (never touched).
  // A resend within a still-valid handoff keeps the original snapshot.
  const now = Date.now()
  const carried = brandProof
    ? carryForwardProofSnapshot({
        priorRaw: request.cookies.get(HANDOFF_COOKIE_NAME)?.value,
        key: handoffKey(),
        flow: "brand-proof",
        email,
        brand: SITE_BRAND,
        now,
      })
    : null
  const iat = carried?.iat ?? now
  const preExistingPasswordlessSubs = brandProof
    ? (carried?.preExistingPasswordlessSubs ?? (await snapshotPasswordlessSubsFor(email)))
    : undefined

  let authSession: string | undefined
  if (brandProof || permitsChallenge) {
    try {
      if (brandProof || flow !== "database") {
        await startEmailPasscode(creds, email, {
          signal: AbortSignal.timeout(PASSCODE_SEND_TIMEOUT_MS),
        })
      } else {
        authSession = await startDatabaseChallenge(creds, email, dbConnectionName)
      }
    } catch (error) {
      if (brandScoped) {
        // The send did not happen: say so, and mint no handoff.
        const failure = passcodeSendFailure(error)
        return refusal(
          failure.status,
          failure.code,
          failure.code === "throttled" ? PASSCODE_THROTTLED_MESSAGE : PASSCODE_UNAVAILABLE_MESSAGE,
        )
      }
      // Unscoped storefronts keep the original non-revealing shape.
    }
  }

  const response = generic()
  response.cookies.set(
    HANDOFF_COOKIE_NAME,
    encodeHandoff(
      brandProof
        ? { flow: "brand-proof", email, iat, brand: SITE_BRAND, preExistingPasswordlessSubs }
        : { flow, email, authSession, iat: now },
    ),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(1, HANDOFF_TTL_SECONDS - Math.floor((now - (brandProof ? iat : now)) / 1000)),
    },
  )
  return response
}
