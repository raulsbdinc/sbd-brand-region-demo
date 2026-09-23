// Provision the UK TEMP tenant (sbd-uk-temp1.uk.auth0.com) to parity with the
// observed old UK config.
// ============================================================================
// The new UK tenant starts with only the Default App + default DB connection +
// zero users. Models 3 & 4 (UK per-email independent passwords/resets, UK
// per-brand independent passwords/resets with proof before linking) need:
//   • the THREE custom database connections the storefronts resolve to
//     (AUTH0_{DEWALT,STANLEY,PER_EMAIL}_CONNECTION), with controlled-signup
//     settings matching the old tenant,
//   • the TWO UK storefront web applications (DeWalt UK, Stanley UK),
//   • an "Account Management (UK)" M2M app authorized for the Management API
//     (AUTH0_MGMT_CLIENT_ID/SECRET — Model 3/4 create/link/reset call it),
//   • a passwordless email connection enabled on both apps (emailed OTP),
//   • the add-sbd-claims Post-Login action (emitted with real UK client IDs).
//
// Observed old-tenant parity (read-only reference, both UK apps identical):
//   grants  = implicit, authorization_code, refresh_token, password-realm,
//             passwordless/otp
//   conns   = sbd-demo-dewalt, sbd-demo-per-email, sbd-demo-stanley (all custom
//             DB), Username-Password-Authentication (default), google-oauth2,
//             passwordless email — all enabled on both apps
//   custom DB connection options: Disable Sign Ups = ON,
//             Improved brute-force protection = ON, Requires Username = OFF
//
// CONTROLLED SIGNUP: the three custom DB connections are created with
// disable_signup:true on purpose — the app registers through the Management API
// (Model 3/4 create/link/reset), NOT public database signup. This script never
// enables public signup on them.
//
// TARGET: defaults to the verified sbd-uk-temp1.uk.auth0.com (region UK-1).
// Old sbd-uk-temp.uk.auth0.com is a READ-ONLY reference and is REFUSED as a
// mutation target by assertMutableTarget(). Override with --domain / AUTH0_UK_DOMAIN.
//
// DRY-RUN BY DEFAULT. Prints exact create calls (method, path, body) and
// changes nothing until --apply. Idempotent: existing apps/connections/grants
// matched by name/audience are reused, not duplicated.
//
//   export AUTH0_MGMT_TOKEN='...'                 # UK Management token
//   node setup-uk.mjs                             # DRY RUN plan
//   node setup-uk.mjs --apply
//   node setup-uk.mjs --apply --emit-action
//
// Token scopes: read/create:connections, update:connections,
//   read/create/update:clients, read/create:client_grants.
// Manual follow-ups (need external secrets, not scripted here): create/enable
//   the google-oauth2 social connection (client id/secret) on the 2 apps for
//   Model 2-style linked Google; deploy the emitted action + set its
//   SBD_API_AUDIENCE secret; confirm the passwordless email OTP template.

import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, resolveDomain, resolveToken, assertMutableTarget, mgmtFetch, paginate } from "./mgmt.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))

// The two UK storefront apps. Keys/labels MUST match the stable site ids in
// auth0/actions/add-sbd-claims.js (dewalt-uk / stanley-uk).
const APPS = [
  { key: "dewalt-uk", name: "SBD Demo - DeWalt UK", label: "DeWalt UK", origin: "https://sbd-demo-dewalt-uk.vercel.app" },
  { key: "stanley-uk", name: "SBD Demo - Stanley UK", label: "Stanley UK", origin: "https://sbd-demo-stanley-uk.vercel.app" },
]
const DEV_ORIGIN = "http://localhost:3000"

// The three custom DB connections. Names must match what the UK storefronts
// resolve via AUTH0_{DEWALT,STANLEY,PER_EMAIL}_CONNECTION.
const DB_CONNECTIONS = [
  { key: "dewalt", name: process.env.AUTH0_DEWALT_CONNECTION || "sbd-demo-dewalt" },
  { key: "stanley", name: process.env.AUTH0_STANLEY_CONNECTION || "sbd-demo-stanley" },
  { key: "per-email", name: process.env.AUTH0_PER_EMAIL_CONNECTION || "sbd-demo-per-email" },
]

// Controlled-signup parity for the custom DB connections. requires_username:false
// (Requires Username OFF). Public signup is disabled — the app creates users via
// the Management API only.
const DB_OPTIONS = { disable_signup: true, brute_force_protection: true, requires_username: false }

// Passwordless email connection (emailed OTP sign-in), enabled on both apps.
const PASSWORDLESS_CONNECTION = process.env.AUTH0_PASSWORDLESS_EMAIL_CONNECTION || "email"
// Observed old-tenant passwordless email parity: OTP expiry 180s, OTP length 6,
// Disable Sign Ups UNCHECKED. Auth0 stores these under options.totp
// (time_step seconds / length digits).
const PASSWORDLESS_OPTIONS = { disable_signup: false, totp: { time_step: 180, length: 6 } }
// The default database connection present on a fresh tenant, enabled on both apps for parity.
const DEFAULT_DB_CONNECTION = "Username-Password-Authentication"

const MGMT_APP_NAME = "Account Management (UK)"
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

// Observed old-tenant grants on BOTH UK apps.
const WEB_APP_GRANTS = [
  "implicit",
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

async function findClientByName(domain, token, name) {
  const clients = await paginate(domain, token, "/clients?fields=client_id,name,app_type&include_fields=true")
  return clients.find((c) => c.name === name) || null
}

async function findConnectionByName(domain, token, name) {
  const conns = await paginate(domain, token, "/connections")
  return conns.find((c) => c.name === name) || null
}

async function findClientGrant(domain, token, clientId, audience) {
  const grants = await paginate(domain, token, `/client-grants?client_id=${encodeURIComponent(clientId)}`)
  return grants.find((g) => g.audience === audience) || null
}

async function main() {
  const args = parseArgs()
  // Default to the verified UK-region tenant; refuse old/rejected tenants.
  const domain = assertMutableTarget(resolveDomain({ ...args, tenant: args.tenant || "uk" }))
  const token = resolveToken()
  const apply = Boolean(args.apply)
  const mgmtAudience = `https://${domain}/api/v2/`

  const plan = []
  const record = (method, path, body) => plan.push({ method, path, body })

  // 1) Ensure the two storefront web apps exist. Their client_ids scope the
  //    connections' enabled_clients and the claims action.
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

  const enabledClients = Object.values(clientIds)

  // Helper: create-or-update a connection so both apps are enabled on it.
  async function ensureConnection({ name, strategy, options }) {
    const existing = await findConnectionByName(domain, token, name)
    if (existing) {
      process.stderr.write(`connection "${name}" exists → ${existing.id}\n`)
      const merged = [...new Set([...(existing.enabled_clients || []), ...enabledClients])]
      // Re-assert options (e.g. disable_signup) without clobbering unrelated ones.
      const body = options
        ? { enabled_clients: merged, options: { ...(existing.options || {}), ...options } }
        : { enabled_clients: merged }
      record("PATCH", `/connections/${existing.id}`, body)
      if (apply && enabledClients.length) {
        await mgmtFetch(domain, token, `/connections/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
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

  // 2) The three custom DB connections (controlled signup, brute-force on).
  for (const conn of DB_CONNECTIONS) {
    await ensureConnection({ name: conn.name, strategy: "auth0", options: DB_OPTIONS })
  }

  // 3) Default DB connection + passwordless email connection, enabled on both apps.
  await ensureConnection({ name: DEFAULT_DB_CONNECTION, strategy: "auth0" })
  await ensureConnection({ name: PASSWORDLESS_CONNECTION, strategy: "email", options: PASSWORDLESS_OPTIONS })

  // 4) M2M app + its Management API grant (AUTH0_MGMT_CLIENT_ID/SECRET).
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
    record("POST", "/client-grants", {
      client_id: "<m2m client_id after --apply>",
      audience: mgmtAudience,
      scope: MGMT_SCOPES,
    })
  }

  // 5) Optionally emit a ready-to-deploy claims action whose
  //    DEMO_SITES_BY_CLIENT_ID is populated with the UK client IDs. UK hosts
  //    only the two UK apps; the EU apps live on the Europe tenant.
  if (args["emit-action"]) {
    const src = await readFile(join(HERE, "..", "..", "auth0", "actions", "add-sbd-claims.js"), "utf8")
    const haveAll = APPS.every((a) => clientIds[a.key])
    const block =
      "const DEMO_SITES_BY_CLIENT_ID = {\n" +
      APPS.map(
        (a) =>
          `  ${JSON.stringify(clientIds[a.key] || "__SET_AFTER_APPLY__")}: { id: ${JSON.stringify(a.key)}, label: ${JSON.stringify(a.label)} },`,
      ).join("\n") +
      "\n}"
    const replaced = src.replace(/const DEMO_SITES_BY_CLIENT_ID = \{[\s\S]*?\n\}/, block)
    if (replaced === src) {
      throw new Error("Could not locate DEMO_SITES_BY_CLIENT_ID block to rewrite in add-sbd-claims.js")
    }
    const header =
      `// GENERATED for the UK tenant ${domain}.\n` +
      (haveAll
        ? `// DEMO_SITES_BY_CLIENT_ID below is populated with the live UK client IDs.\n`
        : `// WARNING: run with --apply first so client IDs exist; entries show __SET_AFTER_APPLY__.\n`) +
      `// Deploy as a Post-Login action bound to the login flow, then set the\n` +
      `// action secret SBD_API_AUDIENCE (the approved SBD API identifier).\n\n`
    await mkdir(join(HERE, "out"), { recursive: true })
    await writeFile(join(HERE, "out", "add-sbd-claims.uk.js"), header + replaced, "utf8")
    process.stderr.write(
      `wrote scripts/auth0-migration/out/add-sbd-claims.uk.js${haveAll ? "" : " (placeholders — re-run with --apply)"}\n`,
    )
  }

  process.stderr.write(`\n${apply ? "APPLIED" : "DRY RUN"} — planned ${plan.length} write(s) on ${domain}\n`)
  process.stdout.write(
    JSON.stringify(
      {
        domain,
        dbConnections: DB_CONNECTIONS.map((c) => c.name),
        dbOptions: DB_OPTIONS,
        passwordlessConnection: PASSWORDLESS_CONNECTION,
        defaultDbConnection: DEFAULT_DB_CONNECTION,
        mgmtAudience,
        clientIds,
        mgmtClientId,
        plan,
      },
      null,
      2,
    ) + "\n",
  )
  if (!apply) {
    process.stderr.write(
      `Re-run with --apply to execute. Add --emit-action to write the claims action copy.\n` +
        `Manual follow-ups: google-oauth2 social connection (needs client id/secret), deploy the\n` +
        `emitted action + set SBD_API_AUDIENCE, verify the passwordless email OTP template.\n\n`,
    )
  }
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`)
  process.exit(1)
})
