// POST /api/signin/passcode/start  { email }
// ===========================================
// Server-side entry point for passcode sign-in. It resolves — entirely on the
// server — whether the address is a DATABASE user or takes the PASSWORDLESS
// flow, sends the code the matching way, and stashes the decision + address +
// any auth_session in a short-lived httpOnly handoff cookie.
//
// The response body is IDENTICAL in every case ({ ok: true }), and stays 200
// even when sending fails. Nothing about which flow ran, or whether the address
// exists, is ever returned — otherwise the endpoint would be an email
// enumeration oracle. All the drawer learns is "a code was sent, go enter it".

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
import { brandAccessEnforced } from "@/lib/brand-access"
import { SITE_BRAND, SITE_MARKET } from "@/lib/site"
import {
  HANDOFF_COOKIE_NAME,
  HANDOFF_TTL_SECONDS,
  encodeHandoff,
} from "@/lib/passcode-handoff"

export const runtime = "nodejs"

// Always the same to the caller: a code was (attempted to be) sent.
function generic(): NextResponse {
  return NextResponse.json({ ok: true })
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
  const { flow, dbConnectionName, permitsChallenge } = planPasscodeStart({
    baseFlow,
    resolutionKind: resolution.kind,
    resolvedConnectionName:
      resolution.kind === "resolved" ? resolution.connectionName : undefined,
    brandScoped: brandAccessEnforced(SITE_MARKET),
  })

  // The EU tenant does not support native database OTP on the brand
  // connections, so a brand-enrolled (Model 4) customer's code goes out on the
  // passwordless email connection as mailbox proof. Verify consumes it and then
  // re-resolves the brand-enrolled canonical; no session comes from the code.
  const brandScoped = brandAccessEnforced(SITE_MARKET)
  const brandProof =
    brandScoped &&
    permitsChallenge &&
    flow === "database" &&
    !!dbConnectionName &&
    resolution.kind === "resolved"

  // Recorded BEFORE the challenge is sent, so verify can tell a stub minted by
  // THIS challenge from any pre-existing email-only account (never touched).
  const preExistingPasswordlessSubs = brandProof
    ? await snapshotPasswordlessSubsFor(email)
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
        ? { flow: "brand-proof", email, iat: Date.now(), brand: SITE_BRAND, preExistingPasswordlessSubs }
        : { flow, email, authSession, iat: Date.now() },
    ),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: HANDOFF_TTL_SECONDS,
    },
  )
  return response
}
