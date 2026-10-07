// POST /api/signin/passcode/start  { email }
// ===========================================
// Brand storefronts (FR, DE, UK: brand access enforced, mailbox proof) run
// runBrandPasscodeStart (lib/passcode-start-core.ts), which decides BEFORE any
// send under ONE interactive deadline and reports the outcome truthfully:
//   200 {ok:true}                              code sent; handoff cookie set
//   400 {code:"invalid-email"}                 missing or malformed email
//   404 {code:"not-registered"}                no account for this brand
//   409 {code:"conflict"}                      distinct customers claim it
//   429 {code:"throttled"}                     the provider throttled the send
//   503 {code:"provider-unavailable"}          lookup, snapshot or send failed
// Only the 200 sends mail and sets a handoff. Other storefronts keep the
// original non-revealing behavior below, unchanged.

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
import { brandAccessEnforced, brandPasscodeUsesMailboxProof } from "@/lib/brand-access"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import {
  HANDOFF_COOKIE_NAME,
  HANDOFF_TTL_SECONDS,
  encodeHandoff,
  handoffKey,
} from "@/lib/passcode-handoff"
import { carryForwardProofSnapshot } from "@/lib/ownership-otp-proof"
import { runBrandPasscodeStart } from "@/lib/passcode-start-core"

export const runtime = "nodejs"

// Always the same to the caller: a code was (attempted to be) sent.
function generic(): NextResponse {
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  if (!(brandAccessEnforced(SITE_MARKET) && brandPasscodeUsesMailboxProof(SITE_MARKET))) {
    return legacyPasscodeStart(request)
  }

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  const priorRaw = request.cookies.get(HANDOFF_COOKIE_NAME)?.value

  const result = await runBrandPasscodeStart(
    { body, siteBrand: SITE_BRAND, hasCreds: !!creds, handoffTtlSeconds: HANDOFF_TTL_SECONDS },
    {
      now: Date.now,
      resolve: (email, opts) => resolveSigninCredential(email, SITE_BRAND, opts),
      carryForward: (email, now) =>
        carryForwardProofSnapshot({
          priorRaw,
          key: handoffKey(),
          flow: "brand-proof",
          email,
          brand: SITE_BRAND,
          now,
        }),
      snapshot: (email, opts) => snapshotPasswordlessSubsFor(email, opts),
      send: (email, opts) => startEmailPasscode(creds!, email, opts),
    },
  )

  if (result.status !== 200) {
    return NextResponse.json(result.body, { status: result.status })
  }
  const response = NextResponse.json(result.body)
  response.cookies.set(HANDOFF_COOKIE_NAME, encodeHandoff(result.handoff), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: result.maxAgeSeconds,
  })
  return response
}

async function legacyPasscodeStart(request: NextRequest): Promise<NextResponse> {
  let email = ""
  try {
    const body = await request.json()
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  } catch {
    return generic()
  }
  if (!email) return generic()

  const creds = resolvePasswordlessCreds(request.headers.get("cookie"))
  if (!creds) return generic()

  // Decide the flow on the server. This is the ONLY place the decision is made
  // and it never leaves the server.
  //
  // First ask the credential resolver whether this email + SITE_BRAND maps to a
  // per-email (case 3) or per-brand (case 4) database connection, is ambiguous,
  // is unavailable, or should take the ordinary shared path. A "resolved"
  // non-shared credential makes the passcode a DATABASE challenge on THAT
  // connection; "shared-default" falls back to the original resolver (shared
  // database vs passwordless) so cases 1 & 2 are completely unchanged.
  const resolution = await resolveSigninCredential(email).catch(
    () => ({ kind: "unavailable" }) as const,
  )

  // Resolve the base flow via the DIRECT users-by-email lookup, then let the
  // pure planner decide the final flow/connection. A per-email (case 3) /
  // per-brand (case 4) binding only REFINES an already-database challenge — it
  // must NEVER promote a passwordless resolution (a linked ALTERNATE email that
  // lives on the passwordless "email" connection) into a database challenge the
  // address can't satisfy. Doing so sent nothing and the failure was swallowed
  // for anti-enumeration, so the customer never received a code.
  const baseFlow = await resolvePasscodeFlow(email)
  const brandScoped = brandAccessEnforced(SITE_MARKET)
  // On an enforced storefront only THIS brand's realm counts as enrollment.
  const ownsSiteBrand =
    resolution.kind === "resolved" &&
    (!brandScoped || resolution.connectionKey === SITE_BRAND)
  const { flow, dbConnectionName, permitsChallenge } = planPasscodeStart({
    baseFlow,
    // Another brand's realm is not enrollment here: treat it as unbound.
    resolutionKind: ownsSiteBrand ? "resolved" : resolution.kind === "resolved" ? "shared-default" : resolution.kind,
    resolvedConnectionName:
      ownsSiteBrand && resolution.kind === "resolved" ? resolution.connectionName : undefined,
    brandScoped,
  })

  // Neither the EU nor the UK tenant supports native database OTP on the brand
  // connections, so a brand-enrolled (Model 4) customer's code goes out on the
  // passwordless email connection as mailbox proof. Verify consumes it and then
  // re-resolves the brand-enrolled canonical; no session comes from the code.
  const brandProof =
    brandPasscodeUsesMailboxProof(SITE_MARKET) &&
    brandScoped &&
    permitsChallenge &&
    flow === "database" &&
    !!dbConnectionName &&
    resolution.kind === "resolved"

  // Recorded BEFORE the challenge is sent, so verify can tell a stub minted by
  // THIS challenge from any pre-existing email-only account (never touched).
  // A resend within a still-valid signed brand-proof handoff for the same
  // email + brand keeps the ORIGINAL snapshot and expiry anchor, so a stub the
  // first send may have minted is never misread as pre-existing.
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
  // AMBIGUOUS or UNAVAILABLE — fail CLOSED: issue NO challenge on ANY realm. We
  // still set the handoff (with no auth_session) below so the verify step fails
  // with the same generic message, keeping the response shape identical and
  // non-revealing.
  if (permitsChallenge) {
    try {
      if (brandProof) {
        await startEmailPasscode(creds, email)
      } else if (flow === "database") {
        authSession = await startDatabaseChallenge(creds, email, dbConnectionName)
      } else {
        await startEmailPasscode(creds, email)
      }
    } catch {
      // Sending failed (unknown address on the DB challenge, throttling, etc.).
      // Still return the generic shape — and still set a handoff so the verify
      // step fails with the same generic message rather than revealing anything
      // by its absence.
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
