// Provision the Europe TEMP tenant to parity with the EU model.
// ============================================================================
// The Europe tenant starts with only the Default App + default DB connection +
// zero users. Models 1 & 2 (shared EU password, verified alternate email / OTP
// / linked Google, no duplicate profile) need:
//   • a shared database connection,
//   • the three EU storefront web applications,
//   • an "Account Management" M2M app authorized for the Management API
//     (the app itself calls Management for getUserByEmail / linkIdentity /
//     password-change tickets — AUTH0_MGMT_CLIENT_ID/SECRET on the storefronts),
//   • the add-sbd-claims Post-Login action (deployed manually with real IDs).
//
// TARGET DOMAIN IS NOT HARD-CODED. The old US-5 `sbd-emea-temp.us.auth0.com`
// conflicts with the CIAM-14 residency map and is REJECTED here. Pass the
// verified EU-region tenant with `--domain <host>` or `AUTH0_EUROPE_DOMAIN`
// (e.g. sbd-emea-eu-temp.eu.auth0.com).
//
// DRY-RUN BY DEFAULT. It prints the exact create calls (method, path, body)
// and changes nothing until --apply. It is idempotent: existing connections/
// apps/grants matched by name/audience are reused, not duplicated.
//
//   export AUTH0_MGMT_TOKEN='...'                 # Europe Management token
//   node setup-emea.mjs --domain <eu-host>        # DRY RUN plan
//   node setup-emea.mjs --domain <eu-host> --apply
//   node setup-emea.mjs --domain <eu-host> --apply --emit-action
//
// Token scopes: read/create:connections, read/create/update:clients,
//   read/create:client_grants.
// Manual follow-ups (need external secrets, not scripted here): enable the
//   google-oauth2 social connection on the 3 apps for Model 2 "linked Google";
//   deploy the emitted action and set its SBD_API_AUDIENCE secret.

import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  parseArgs,
  resolveDomain,
  resolveToken,
  assertMutableTarget,
  mgmtFetch,
  paginate,
  getConnectionEnabledClientIds,
} from "./mgmt.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))

// The shared connection name must match what the EU storefronts resolve to
// (AUTH0_SHARED_CONNECTION → AUTH0_CONNECTION → NEXT_PUBLIC_AUTH0_CONNECTION).
// Whatever is chosen here MUST be written into those storefront env vars.
const SHARED_CONNECTION =
  process.env.AUTH0_EUROPE_CONNECTION || process.env.AUTH0_EMEA_CONNECTION || "sbd-emea"

// The three EU storefront apps. Callback/logout/web-origin URLs follow the SDK
// routes in lib/auth0.ts (/auth/callback, origin logout) plus localhost dev.
const APPS = [
  { key: "dewalt-fr", name: "DeWalt France", origin: "https://sbd-demo-dewalt-fr.vercel.app" },
  { key: "dewalt-de", name: "DeWalt Germany", origin: "https://sbd-demo-dewalt-de.vercel.app" },
  { key: "stanley-fr", name: "Stanley France", origin: "https://sbd-demo-stanley-fr.vercel.app" },
]
const DEV_ORIGIN = "http://localhost:3000"

// Passwordless email connection (emailed OTP). Model 2 verified-alternate-email
// / OTP sign-in (lib/auth0-passwordless.ts → /passwordless/start + the
// passwordless/otp grant) REQUIRES it; the three EU apps already carry that
// grant, so without this connection those flows fail. Parity with the observed
// tenant config: OTP expiry 180s, length 6, signup enabled.
const PASSWORDLESS_CONNECTION = process.env.AUTH0_PASSWORDLESS_EMAIL_CONNECTION || "email"
const PASSWORDLESS_OPTIONS = { disable_signup: false, totp: { time_step: 180, length: 6 } }

// The M2M app that backs AUTH0_MGMT_CLIENT_ID/SECRET on the storefronts. Model 2
// (linked Google reconcile, verified-alternate lookups) calls the Management
// API from the app, so this grant is required — not optional.
const MGMT_APP_NAME = "Account Management (Europe)"
const MGMT_SCOPES = [
  "read:users",
  "create:users",
  "update:users",
  "delete:users",
  "read:users_app_metadata",
  "update:users_app_metadata",
  "create:user_tickets",
  "read:connections",
]

// Required grant types, matched to how the app actually authenticates:
//   • authorization_code + refresh_token — the Next.js SDK login (lib/auth0.ts)
//   • password-realm  — app/api/signin/password + Model-4 proof
//                       (lib/auth0-password-grant.ts)
//   • passwordless/otp — emailed-code sign-in (lib/auth0-passcode-signin.ts)
// A web app missing password-realm/passwordless would 403 those grants and
// sign-in would fail even with correct credentials.
const WEB_APP_GRANTS = [
  "authorization_code",
  "refresh_token",
  "http://auth0.com/oauth/grant-type/password-realm",
  "http://auth0.com/oauth/grant-type/passwordless/otp",
]

function appPayload(app) {
  const origins = [app.origin, DEV_ORIGIN]
  return {
    name: app.name,
    app_type: "regular_web",
    callbacks: origins.map((o) => `${o}/auth/callback`),
    allowed_logout_urls: origins,
    web_origins: origins,
    allowed_origins: origins,
    grant_types: WEB_APP_GRANTS,
    oidc_conformant: true,
    token_endpoint_auth_method: "client_secret_post",
  }
}

async function findConnectionByName(domain, token, name) {
  // No strategy filter: the passwordless connection is strategy "email", not
  // "auth0", so filtering would miss it on rerun and POST a duplicate (409).
  const conns = await paginate(domain, token, "/connections")
  return conns.find((c) => c.name === name) || null
}

async function findClientByName(domain, token, name) {
  const clients = await paginate(domain, token, "/clients?fields=client_id,name,app_type&include_fields=true")
  return clients.find((c) => c.name === name) || null
}

async function findClientGrant(domain, token, clientId, audience) {
  const grants = await paginate(domain, token, `/client-grants?client_id=${encodeURIComponent(clientId)}`)
  return grants.find((g) => g.audience === audience) || null
}

async function main() {
  const args = parseArgs()
  // Default to the verified EU-region Europe tenant; refuse old/rejected
  // tenants (US-5 sbd-emea-temp, stray sbd-eu-temp, reference-only old UK).
  const domain = assertMutableTarget(resolveDomain({ ...args, tenant: args.tenant || "europe" }), "europe")

  const token = resolveToken()
  const apply = Boolean(args.apply)
  const mgmtAudience = `https://${domain}/api/v2/`

  const plan = []
  const record = (method, path, body) => plan.push({ method, path, body })

  // 1) Ensure the three storefront web apps exist (their client_ids scope the
  //    connection's enabled_clients and the claims action).
  const clientIds = {}
  for (const app of APPS) {
    const existing = await findClientByName(domain, token, app.name)
    if (existing) {
      clientIds[app.key] = existing.client_id
      process.stderr.write(`app "${app.name}" exists → ${existing.client_id}\n`)
      continue
    }
    record("POST", "/clients", appPayload(app))
    if (apply) {
      const created = await mgmtFetch(domain, token, "/clients", {
        method: "POST",
        body: JSON.stringify(appPayload(app)),
      })
      clientIds[app.key] = created.client_id
      process.stderr.write(`created app "${app.name}" → ${created.client_id}\n`)
    }
  }

  // Ensure a connection exists and that the EU apps are enabled on it. At
  // create time POST /connections still accepts enabled_clients. On rerun, the
  // enabled-clients set must be read/written via the dedicated
  // /connections/{id}/clients endpoints (the legacy enabled_clients field on
  // GET/PATCH /connections/{id} is EOL for new/development tenants); PATCH there
  // is additive per-client ([{client_id, status:true}]).
  const enabledClients = Object.values(clientIds)
  async function ensureConnectionEnabled({ name, strategy, options }) {
    const existing = await findConnectionByName(domain, token, name)
    if (existing) {
      process.stderr.write(`connection "${name}" exists → ${existing.id}\n`)
      if (options) {
        const optBody = { options: { ...(existing.options || {}), ...options } }
        record("PATCH", `/connections/${existing.id}`, optBody)
        if (apply) {
          await mgmtFetch(domain, token, `/connections/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify(optBody),
          })
        }
      }
      const already = await getConnectionEnabledClientIds(domain, token, existing.id)
      const toEnable = enabledClients.filter((id) => !already.has(id))
      if (toEnable.length) {
        const clientsBody = toEnable.map((client_id) => ({ client_id, status: true }))
        record("PATCH", `/connections/${existing.id}/clients`, clientsBody)
        if (apply) {
          await mgmtFetch(domain, token, `/connections/${existing.id}/clients`, {
            method: "PATCH",
            body: JSON.stringify(clientsBody),
          })
        }
      }
      return existing.id
    }
    const body = { name, strategy, enabled_clients: enabledClients, ...(options ? { options } : {}) }
    record("POST", "/connections", body)
    if (apply) {
      const created = await mgmtFetch(domain, token, "/connections", {
        method: "POST",
        body: JSON.stringify(body),
      })
      process.stderr.write(`created connection "${name}" (${strategy}) → ${created.id}\n`)
      return created.id
    }
    return null
  }

  // Collect created/existing connection IDs by name so the Vercel env cutover
  // reads AUTH0_*_CONNECTION_ID from the machine-readable summary (stdout JSON)
  // instead of scraping stderr. null on a dry run (connections not created yet).
  const connectionIds = {}

  // 2) Shared EU database connection (Model 1 shared password; signup allowed).
  connectionIds[SHARED_CONNECTION] = await ensureConnectionEnabled({ name: SHARED_CONNECTION, strategy: "auth0" })

  // 3) Passwordless email connection (Model 2 verified-alternate-email / OTP).
  //    Without it the passwordless/otp grant on the EU apps has no connection
  //    to authenticate against and emailed-code sign-in fails.
  connectionIds[PASSWORDLESS_CONNECTION] = await ensureConnectionEnabled({
    name: PASSWORDLESS_CONNECTION,
    strategy: "email",
    options: PASSWORDLESS_OPTIONS,
  })

  // 4) Ensure the M2M app + its Management API grant exist. This is what
  //    AUTH0_MGMT_CLIENT_ID/SECRET point at; Model 2 breaks without it.
  let mgmtClientId = null
  const existingMgmt = await findClientByName(domain, token, MGMT_APP_NAME)
  if (existingMgmt) {
    mgmtClientId = existingMgmt.client_id
    process.stderr.write(`m2m app "${MGMT_APP_NAME}" exists → ${mgmtClientId}\n`)
  } else {
    const body = { name: MGMT_APP_NAME, app_type: "non_interactive" }
    record("POST", "/clients", body)
    if (apply) {
      const created = await mgmtFetch(domain, token, "/clients", {
        method: "POST",
        body: JSON.stringify(body),
      })
      mgmtClientId = created.client_id
      process.stderr.write(`created m2m app "${MGMT_APP_NAME}" → ${mgmtClientId}\n`)
    }
  }

  if (mgmtClientId) {
    const existingGrant = await findClientGrant(domain, token, mgmtClientId, mgmtAudience)
    if (existingGrant) {
      process.stderr.write(`client_grant for m2m → Management API exists (${existingGrant.id})\n`)
    } else {
      const body = { client_id: mgmtClientId, audience: mgmtAudience, scope: MGMT_SCOPES }
      record("POST", "/client-grants", body)
      if (apply) {
        await mgmtFetch(domain, token, "/client-grants", { method: "POST", body: JSON.stringify(body) })
        process.stderr.write(`granted m2m app the Management API scopes\n`)
      }
    }
  } else {
    // Dry run: the M2M grant can only be planned once the client id exists.
    record("POST", "/client-grants", { client_id: "<m2m client_id after --apply>", audience: mgmtAudience, scope: MGMT_SCOPES })
  }

  // 5) Optionally emit a ready-to-deploy claims action whose
  //    DEMO_SITES_BY_CLIENT_ID is ACTUALLY populated with the EU client IDs
  //    (Europe hosts only the three EU apps; the UK apps live on the UK tenant).
  if (args["emit-action"]) {
    const src = await readFile(join(HERE, "..", "..", "auth0", "actions", "add-sbd-claims.js"), "utf8")
    const haveAll = APPS.every((a) => clientIds[a.key])
    const block =
      "const DEMO_SITES_BY_CLIENT_ID = {\n" +
      APPS.map(
        (a) =>
          `  ${JSON.stringify(clientIds[a.key] || "__SET_AFTER_APPLY__")}: { id: ${JSON.stringify(a.key)}, label: ${JSON.stringify(a.name)} },`,
      ).join("\n") +
      "\n}"
    const replaced = src.replace(/const DEMO_SITES_BY_CLIENT_ID = \{[\s\S]*?\n\}/, block)
    if (replaced === src) {
      throw new Error("Could not locate DEMO_SITES_BY_CLIENT_ID block to rewrite in add-sbd-claims.js")
    }
    const header =
      `// GENERATED for the Europe tenant ${domain}.\n` +
      (haveAll
        ? `// DEMO_SITES_BY_CLIENT_ID below is populated with the live Europe client IDs.\n`
        : `// WARNING: run with --apply first so client IDs exist; entries show __SET_AFTER_APPLY__.\n`) +
      `// Deploy as a Post-Login action bound to the login flow, then set the\n` +
      `// action secret SBD_API_AUDIENCE (the approved SBD API identifier).\n\n`
    await mkdir(join(HERE, "out"), { recursive: true })
    await writeFile(join(HERE, "out", "add-sbd-claims.emea.js"), header + replaced, "utf8")
    process.stderr.write(
      `wrote scripts/auth0-migration/out/add-sbd-claims.emea.js${haveAll ? "" : " (placeholders — re-run with --apply)"}\n`,
    )
  }

  process.stderr.write(`\n${apply ? "APPLIED" : "DRY RUN"} — planned ${plan.length} write(s) on ${domain}\n`)
  process.stdout.write(
    JSON.stringify(
      { domain, sharedConnection: SHARED_CONNECTION, mgmtAudience, clientIds, connectionIds, mgmtClientId, plan },
      null,
      2,
    ) + "\n",
  )
  if (!apply) process.stderr.write(`Re-run with --apply to execute. Add --emit-action to write the claims action copy.\n\n`)
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`)
  process.exit(1)
})
