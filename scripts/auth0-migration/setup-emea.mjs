// Provision the EMEA TEMP tenant (sbd-emea-temp) to parity with the EU model.
// ============================================================================
// The EMEA tenant currently has only the Default App + default DB connection +
// zero users. Models 1 & 2 (shared EU password, verified alternate email / OTP
// / linked Google) need a shared database connection and the three EU
// storefront applications, plus the add-sbd-claims Post-Login action.
//
// DRY-RUN BY DEFAULT. It prints the exact create calls (method, path, body)
// and changes nothing until --apply. It is idempotent: existing connections/
// apps matched by name are reused, not duplicated.
//
//   export AUTH0_MGMT_TOKEN='...'      # EMEA Management token
//   node setup-emea.mjs                # DRY RUN plan
//   node setup-emea.mjs --apply        # create connection + apps + enable
//   node setup-emea.mjs --emit-action  # write out/add-sbd-claims.emea.js (no deploy)
//
// Requires token scope: read/create:connections, read/create/update:clients.
// The action itself is deployed manually after client IDs exist (see README).
//
// NOTE (CIAM-15 / CIAM-14): sbd-emea-temp resolves to region US-5
// (issuer https://sbd-emea-temp.us.auth0.com/). The ticket's residency intent
// is EMEA. If the tenant is recreated in an EMEA region to satisfy compliance,
// its domain changes and this script must be re-run against the new domain.

import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, resolveToken, mgmtFetch, paginate } from "./mgmt.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const EMEA_DOMAIN = "sbd-emea-temp.us.auth0.com"

// Operator-confirmable config. The shared connection name must match what the
// EU storefronts resolve (AUTH0_SHARED_CONNECTION → AUTH0_CONNECTION →
// NEXT_PUBLIC_AUTH0_CONNECTION → sbd-eu). Default kept explicit for TEMP.
const SHARED_CONNECTION = process.env.AUTH0_EMEA_CONNECTION || "sbd-emea"

// The three EU storefront apps. Callback/logout/web-origin URLs follow the
// SDK routes in lib/auth0.ts (/auth/callback, origin logout) plus localhost dev.
const APPS = [
  { key: "dewalt-fr", name: "DeWalt France", origin: "https://sbd-demo-dewalt-fr.vercel.app" },
  { key: "dewalt-de", name: "DeWalt Germany", origin: "https://sbd-demo-dewalt-de.vercel.app" },
  { key: "stanley-fr", name: "Stanley France", origin: "https://sbd-demo-stanley-fr.vercel.app" },
]
const DEV_ORIGIN = "http://localhost:3000"

function appPayload(app) {
  const origins = [app.origin, DEV_ORIGIN]
  return {
    name: app.name,
    app_type: "regular_web",
    callbacks: origins.map((o) => `${o}/auth/callback`),
    allowed_logout_urls: origins,
    web_origins: origins,
    allowed_origins: origins,
    grant_types: ["authorization_code", "refresh_token"],
    oidc_conformant: true,
    token_endpoint_auth_method: "client_secret_post",
  }
}

async function findConnectionByName(token, name) {
  const conns = await paginate(EMEA_DOMAIN, token, "/connections?strategy=auth0")
  return conns.find((c) => c.name === name) || null
}

async function findClientByName(token, name) {
  const clients = await paginate(EMEA_DOMAIN, token, "/clients?fields=client_id,name&include_fields=true")
  return clients.find((c) => c.name === name) || null
}

async function main() {
  const args = parseArgs()
  const token = resolveToken()
  const apply = Boolean(args.apply)

  const plan = []
  const record = (method, path, body) => plan.push({ method, path, body })

  // 1) Ensure apps exist first (their client_ids are needed to scope the
  //    connection's enabled_clients and the claims action).
  const clientIds = {}
  for (const app of APPS) {
    const existing = await findClientByName(token, app.name)
    if (existing) {
      clientIds[app.key] = existing.client_id
      process.stderr.write(`app "${app.name}" exists → ${existing.client_id}\n`)
      continue
    }
    record("POST", "/clients", appPayload(app))
    if (apply) {
      const created = await mgmtFetch(EMEA_DOMAIN, token, "/clients", {
        method: "POST",
        body: JSON.stringify(appPayload(app)),
      })
      clientIds[app.key] = created.client_id
      process.stderr.write(`created app "${app.name}" → ${created.client_id}\n`)
    }
  }

  // 2) Ensure the shared DB connection exists and is enabled on those apps.
  const enabledClients = Object.values(clientIds)
  const existingConn = await findConnectionByName(token, SHARED_CONNECTION)
  if (existingConn) {
    process.stderr.write(`connection "${SHARED_CONNECTION}" exists → ${existingConn.id}\n`)
    const merged = [...new Set([...(existingConn.enabled_clients || []), ...enabledClients])]
    record("PATCH", `/connections/${existingConn.id}`, { enabled_clients: merged })
    if (apply && enabledClients.length) {
      await mgmtFetch(EMEA_DOMAIN, token, `/connections/${existingConn.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled_clients: merged }),
      })
    }
  } else {
    const body = { name: SHARED_CONNECTION, strategy: "auth0", enabled_clients: enabledClients }
    record("POST", "/connections", body)
    if (apply) {
      const created = await mgmtFetch(EMEA_DOMAIN, token, "/connections", {
        method: "POST",
        body: JSON.stringify(body),
      })
      process.stderr.write(`created connection "${SHARED_CONNECTION}" → ${created.id}\n`)
    }
  }

  // 3) Optionally emit a ready-to-deploy claims action with real client IDs.
  //    We do NOT rewrite the repo file or deploy here — the action's client-ID
  //    map needs the freshly-minted EMEA client IDs, which only exist after
  //    --apply. This writes a copy for review + manual deploy.
  if (args["emit-action"]) {
    const src = await readFile(join(HERE, "..", "..", "auth0", "actions", "add-sbd-claims.js"), "utf8")
    const header =
      `// GENERATED for EMEA (sbd-emea-temp). Populate DEMO_SITES_BY_CLIENT_ID with:\n` +
      Object.entries(clientIds)
        .map(([k, id]) => `//   ${k}: "${id}"`)
        .join("\n") +
      `\n// then deploy as a Post-Login action bound to the login flow.\n\n`
    await mkdir(join(HERE, "out"), { recursive: true })
    await writeFile(join(HERE, "out", "add-sbd-claims.emea.js"), header + src, "utf8")
    process.stderr.write(`wrote scripts/auth0-migration/out/add-sbd-claims.emea.js\n`)
  }

  process.stderr.write(`\n${apply ? "APPLIED" : "DRY RUN"} — planned ${plan.length} write(s) on ${EMEA_DOMAIN}\n`)
  process.stdout.write(JSON.stringify({ domain: EMEA_DOMAIN, sharedConnection: SHARED_CONNECTION, clientIds, plan }, null, 2) + "\n")
  if (!apply) process.stderr.write(`Re-run with --apply to execute. Add --emit-action to write the claims action copy.\n\n`)
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`)
  process.exit(1)
})
