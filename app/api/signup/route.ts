import { NextResponse, type NextRequest } from "next/server"
import {
  regionFromCookieHeader,
  resolveRegionAuthConfig,
} from "@/lib/auth0-regions"
import { PASSWORD_CONNECTION } from "@/lib/auth0-connections"
import {
  searchUsers,
  getUsersByEmail,
  isManagementConfigured,
  type Auth0User,
} from "@/lib/auth0-management"
import { validateSharedSignupRequest } from "@/lib/account-model"

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

/** Escape a value for use inside a Lucene phrase (same as the password route). */
function luceneEscapePhrase(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Does the typed email ALREADY belong to a database-backed (sbd-eu) account?
 *
 * The tenant's dbconnections/signup only enforces uniqueness within the sbd-eu
 * DATABASE connection, so it happily creates a DUPLICATE sbd-eu user when the
 * address is really a SECONDARY email of an existing account — an alternate
 * linked "email" identity, a linked Google identity, or a persisted login
 * alias — none of which are themselves database users. That breaks "one human,
 * one record, one billable MAU". We detect that case here, BEFORE creating.
 *
 * Detection reuses the SAME signal the password alias resolver trusts:
 *   - a Lucene search on app_metadata.login_alias_emails (where alternates /
 *     Google emails are persisted as aliases) OR the root email, and
 *   - getUsersByEmail as a belt-and-suspenders for a plain root email,
 * then requires a returned user to carry an identity with provider "auth0" on
 * PASSWORD_CONNECTION — i.e. it is genuinely one of THIS deployment's sbd-eu
 * accounts, not some unrelated record.
 *
 * PRIVACY: the caller maps a true result to the SAME generic "exists_or_invalid"
 * the tenant already returns for an existing primary email — no new status,
 * code, or message. It runs on EVERY signup so timing never distinguishes a
 * known from an unknown address, and FAILS OPEN: any error returns false so a
 * legitimate brand-new signup is never blocked.
 */
async function emailBelongsToExistingDbAccount(email: string): Promise<boolean> {
  try {
    const typed = email.toLowerCase()
    const q = luceneEscapePhrase(typed)

    // Query only fields we control (app_metadata alias list) or the root email;
    // never a linked identity's address (not indexed, per DEMO_STATUS).
    const query = `app_metadata.login_alias_emails:"${q}" OR email:"${q}"`
    const [searchMatches, byEmailMatches] = await Promise.all([
      searchUsers(query),
      getUsersByEmail(typed).catch(() => [] as Auth0User[]),
    ])

    const candidates = [...searchMatches, ...byEmailMatches]
    return candidates.some((u) =>
      (u.identities ?? []).some(
        (id) => id.provider === "auth0" && id.connection === PASSWORD_CONNECTION,
      ),
    )
  } catch {
    // FAIL OPEN — never block a legitimate brand-new signup over a lookup blip.
    return false
  }
}

export async function POST(request: NextRequest) {
  let email: string
  let password: string
  let rawBody: Record<string, unknown>
  try {
    rawBody = (await request.json()) as Record<string, unknown>
    email = typeof rawBody?.email === "string" ? (rawBody.email as string).trim() : ""
    password = typeof rawBody?.password === "string" ? (rawBody.password as string) : ""
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

  // Defensive contract guard: the shared route resolves its connection
  // server-side and only ever handles the shared (Model 1/2) signup. Refuse a
  // browser-supplied connection name, and refuse a UK account-model id (those
  // must use the dedicated /api/registration/* endpoints). This can never
  // change EU behaviour — legitimate EU signups send neither field.
  const contract = validateSharedSignupRequest(rawBody)
  if (contract !== null) {
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

  // STEP 1b — Existing-account guard (the actual fix). BEFORE creating, and on
  // EVERY attempt when the Management API is configured, check whether the typed
  // email already belongs to a database-backed account — including SECONDARY
  // addresses (alternate/linked "email" or Google identities, or a persisted
  // login alias) that dbconnections/signup would otherwise let slip through as a
  // brand-new duplicate. If so, return the SAME generic "exists_or_invalid" the
  // tenant returns for an existing primary email — no new status/code/message,
  // no enumeration — and DO NOT call signup, so no duplicate is ever created.
  // The check fails open (see helper), so a lookup error never blocks a
  // legitimate new signup; it just falls through to the tenant, which still
  // rejects an existing PRIMARY db email and is mapped to exists_or_invalid.
  if (isManagementConfigured() && (await emailBelongsToExistingDbAccount(email))) {
    return NextResponse.json<{ status: SignupStatus }>(
      { status: "exists_or_invalid" },
      { status: 409 },
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
