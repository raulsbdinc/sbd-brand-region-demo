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
import { resolveSigninCredential } from "@/lib/credential-resolver"
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
  // or should take the ordinary shared path. A "resolved" non-shared credential
  // makes the passcode a DATABASE challenge on THAT connection; "shared-default"
  // falls back to the original resolver (shared database vs passwordless) so
  // cases 1 & 2 are completely unchanged.
  const resolution = await resolveSigninCredential(email).catch(
    () => ({ kind: "shared-default" }) as const,
  )
  const ambiguous = resolution.kind === "ambiguous"

  let flow = await resolvePasscodeFlow(email)
  let dbConnectionName: string | undefined
  if (resolution.kind === "resolved") {
    flow = "database"
    dbConnectionName = resolution.connectionName
  }

  let authSession: string | undefined
  // AMBIGUOUS — fail CLOSED: issue NO challenge on ANY realm. We still set the
  // handoff (with no auth_session) below so the verify step fails with the same
  // generic message, keeping the response shape identical and non-revealing.
  if (!ambiguous) {
    try {
      if (flow === "database") {
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
    encodeHandoff({ flow, email, authSession, iat: Date.now() }),
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
