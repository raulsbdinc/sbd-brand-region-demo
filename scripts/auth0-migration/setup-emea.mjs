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
import { parseArgs, resolveDomain, resolveToken, assertMutableTarget, mgmtFetch, paginate } from "./mgmt.mjs"

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
  const conns = await paginate(domain, token, "/connections?strategy=auth0")
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
  const domain = assertMutableTarget(resolveDomain({ ...args, tenant: args.tenant || "europe" }))

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

  // 2) Ensure the shared DB connection exists and is enabled on those apps.
  const enabledClients = Object.values(clientIds)
  const existingConn = await findConnectionByName(domain, token, SHARED_CONNECTION)
  if (existingConn) {
    process.stderr.write(`connection "${SHARED_CONNECTION}" exists → ${existingConn.id}\n`)
    const merged = [...new Set([...(existingConn.enabled_clients || []), ...enabledClients])]
    record("PATCH", `/connections/${existingConn.id}`, { enabled_clients: merged })
    if (apply && enabledClients.length) {
      await mgmtFetch(domain, token, `/connections/${existingConn.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled_clients: merged }),
      })
    }
  } else {
    const body = { name: SHARED_CONNECTION, strategy: "auth0", enabled_clients: enabledClients }
    record("POST", "/connections", body)
    if (apply) {
      const created = await mgmtFetch(domain, token, "/connections", {
        method: "POST",
        body: JSON.stringify(body),
      })
      process.stderr.write(`created connection "${SHARED_CONNECTION}" → ${created.id}\n`)
    }
  }

  // 3) Ensure the M2M app + its Management API grant exist. This is what
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

  // 4) Optionally emit a ready-to-deploy claims action whose
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
      { domain, sharedConnection: SHARED_CONNECTION, mgmtAudience, clientIds, mgmtClientId, plan },
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
