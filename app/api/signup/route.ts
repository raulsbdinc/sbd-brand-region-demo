import { NextResponse, type NextRequest } from "next/server"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"

export const runtime = "nodejs"

// Small, stable JSON contract returned to the browser. The tenant's own error
// bodies (which echo the connection name and internals) never reach the client;
// we translate them into exactly these four statuses.
type SignupStatus = "created" | "exists_or_invalid" | "weak_password" | "error"

// WHY weak_password AND exists_or_invalid STAY DISTINCT — DO NOT COLLAPSE THEM.
// At a glance it looks like returning a separate "weak password" status could
// leak that an address is NOT yet registered (a strong-but-existing email gets
// exists_or_invalid; a weak brand-new email gets weak_password). It reveals
// nothing new: Auth0's PUBLIC dbconnections/signup endpoint already returns
// invalid_password vs invalid_signup as distinct codes for this same client id,
// with no secret, to anyone who calls it directly. We are only forwarding a
// distinction the tenant hands out itself, so preserving it is not an
// enumeration regression — and collapsing them would make the live demo worse,
// because a weak password would read to the user as "this account exists". Keep
// them separate.

interface TenantSignupError {
  code?: string
  name?: string
}

export async function POST(request: NextRequest) {
  let email: string
  let password: string
  try {
    const body = await request.json()
    email = typeof body?.email === "string" ? body.email.trim() : ""
    password = typeof body?.password === "string" ? body.password : ""
  } catch {
    return NextResponse.json<{ status: SignupStatus }>(
      { status: "error" },
      { status: 400 },
    )
  }

  if (!email || !password) {
    return NextResponse.json<{ status: SignupStatus }>(
      { status: "error" },
      { status: 400 },
    )
  }

  // STEP 1 — Resolve tenant credentials + connection exactly as the password
  // route does: the region comes from the sbd_region cookie, and its domain /
  // client id come from resolveRegionAuthConfig (which falls back to the shared
  // AUTH0_* vars). The connection is this deployment's PASSWORD_CONNECTION.
  // Unlike the password-realm grant, dbconnections/signup takes NO client
  // secret, so we only require domain + clientId here.
  const region = regionFromCookieHeader(request.headers.get("cookie"))
  const { domain, clientId } = resolveRegionAuthConfig(region)

  if (!domain || !clientId) {
    // Misconfigured deployment — still don't leak specifics to the client.
    return NextResponse.json<{ status: SignupStatus }>(
      { status: "error" },
      { status: 400 },
    )
  }

  // STEP 2 — Create the user at the tenant's signup endpoint, server-side. The
  // client_id and connection stay on the server and never reach the browser.
  // Forward the caller's first x-forwarded-for hop as auth0-forwarded-for so the
  // tenant attributes any protection to the real end-user IP, matching the
  // password route.
  const firstHop = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim()

  try {
    const res = await fetch(`https://${domain}/dbconnections/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(firstHop ? { "auth0-forwarded-for": firstHop } : {}),
      },
      body: JSON.stringify({
        client_id: clientId,
        email,
        password,
        connection: PASSWORD_CONNECTION,
      }),
    })

    // STEP 3 — Map the tenant response to our contract.
    if (res.ok) {
      // 200 with { email, email_verified, _id } — the user was created.
      return NextResponse.json<{ status: SignupStatus }>(
        { status: "created" },
        { status: 200 },
      )
    }

    let body: TenantSignupError = {}
    try {
      body = (await res.json()) as TenantSignupError
    } catch {
      // No / non-JSON body — falls through to the generic error below.
    }

    if (body.code === "invalid_password") {
      // PasswordStrengthError: the typed password fails the connection policy.
      return NextResponse.json<{ status: SignupStatus }>(
        { status: "weak_password" },
        { status: 400 },
      )
    }
    if (body.code === "invalid_signup") {
      // The tenant keeps this generic so it never confirms an address exists;
      // the UI copy hedges to the same effect. (See the comment at the top.)
      return NextResponse.json<{ status: SignupStatus }>(
        { status: "exists_or_invalid" },
        { status: 409 },
      )
    }

    // Any other tenant rejection.
    return NextResponse.json<{ status: SignupStatus }>(
      { status: "error" },
      { status: 400 },
    )
  } catch {
    // Network failure / unreachable tenant.
    return NextResponse.json<{ status: SignupStatus }>(
      { status: "error" },
      { status: 400 },
    )
  }
}
