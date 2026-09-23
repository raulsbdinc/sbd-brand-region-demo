#!/usr/bin/env node
// Non-secret Vercel env cutover for the five storefronts → new TEMP tenants.
//
// Points each storefront project at the freshly provisioned tenant by updating
// ONLY non-secret keys, in place, on whatever environments already carry them:
//
//   EU (sbd-demo-dewalt-fr, -de, sbd-demo-stanley-fr) → sbd-emea-temp1.eu.auth0.com
//   UK (sbd-demo-dewalt-uk, sbd-demo-stanley-uk)      → sbd-uk-temp1.uk.auth0.com
//
// NEVER touched here (operator sets the two secrets out of band; AUTH0_SECRET
// stays shared/unchanged):
//   • AUTH0_CLIENT_SECRET
//   • AUTH0_MGMT_CLIENT_SECRET
//   • AUTH0_SECRET
//
// Connection NAMES are identical between the old and new UK tenants, so the UK
// cutover changes only the tenant-specific *_ID values (+ domain / client id /
// mgmt client id). On EU the shared DB connection was renamed sbd-eu → sbd-emea,
// so the EU name keys change too.
//
// Env changes take effect only on the NEXT deployment, so running --apply does
// not disturb the currently-live deployments. Deploy the five projects only
// AFTER the operator has set the two secrets on each.
//
// Usage:
//   node cutover-vercel-env.mjs            # dry run: read current records, print plan
//   node cutover-vercel-env.mjs --apply    # PATCH the non-secret records in place
//
// Reads Vercel auth from the `vercel` CLI (already authenticated in the shell).

import { execFileSync } from "node:child_process"

const TEAM = "team_VyWYz4IZFMxqmNHqJBb3r1kG"
const APPLY = process.argv.includes("--apply")

// --- Verified non-secret values from the provisioning apply summaries --------
const EU_COMMON = {
  AUTH0_DOMAIN: "sbd-emea-temp1.eu.auth0.com",
  AUTH0_MGMT_CLIENT_ID: "H2HvXE1SaIrM4Rj9CmX9ctUG9Do1cfM7",
  AUTH0_CONNECTION: "sbd-emea",
  NEXT_PUBLIC_AUTH0_CONNECTION: "sbd-emea",
  AUTH0_SHARED_CONNECTION: "sbd-emea",
  AUTH0_SHARED_CONNECTION_ID: "con_KU8eqdaKcyqe1qX2",
}
const UK_COMMON = {
  AUTH0_DOMAIN: "sbd-uk-temp1.uk.auth0.com",
  AUTH0_MGMT_CLIENT_ID: "kzfHj1pbfLAfGg7xFFexdNxfO4B5YiL8",
  // Connection names unchanged (same strings on the new tenant); only IDs move.
  AUTH0_DEWALT_CONNECTION_ID: "con_cICLBgp8WQnVztzj",
  AUTH0_STANLEY_CONNECTION_ID: "con_945ai7bFRemKRxpW",
  AUTH0_PER_EMAIL_CONNECTION_ID: "con_WP5nk02nfTZYloqV",
  AUTH0_SHARED_CONNECTION_ID: "con_JOFBi8sjtlM5vHL9", // Username-Password-Authentication
}

const PROJECTS = [
  { name: "sbd-demo-dewalt-fr", vals: { ...EU_COMMON, AUTH0_CLIENT_ID: "L9LW9i6oXjqDuYu4TZEQnh2f44wXwjuy" } },
  { name: "sbd-demo-dewalt-de", vals: { ...EU_COMMON, AUTH0_CLIENT_ID: "jXsDL8Kc7jtU2kheSmGR3IpmWVw8PtQL" } },
  { name: "sbd-demo-stanley-fr", vals: { ...EU_COMMON, AUTH0_CLIENT_ID: "pqKEUgMuAAcPqbTFn1IJYAk7poRV3jlX" } },
  { name: "sbd-demo-dewalt-uk", vals: { ...UK_COMMON, AUTH0_CLIENT_ID: "ukHzft4TtGOa9BbqDddP29oCTCSGHJhR" } },
  { name: "sbd-demo-stanley-uk", vals: { ...UK_COMMON, AUTH0_CLIENT_ID: "2uMHQlpj6SRxKISbAXB0eXLweom0eHB3" } },
]

// Guard: these keys must never be written by this script.
const FORBIDDEN = new Set(["AUTH0_CLIENT_SECRET", "AUTH0_MGMT_CLIENT_SECRET", "AUTH0_SECRET"])
for (const p of PROJECTS) {
  for (const k of Object.keys(p.vals)) {
    if (FORBIDDEN.has(k)) {
      console.error(`Refusing to run: ${p.name} plan contains protected secret key ${k}`)
      process.exit(1)
    }
  }
}

function api(pathname, method = "GET", body) {
  const args = ["api", pathname, "--scope", TEAM, "--raw"]
  if (method !== "GET") args.push("-X", method)
  const opts = { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  if (body !== undefined) {
    args.push("--input", "-")
    opts.input = JSON.stringify(body)
  }
  return execFileSync("vercel", args, opts)
}

function listEnv(project) {
  const raw = api(`/v10/projects/${project}/env?decrypt=false`)
  const json = JSON.parse(raw)
  return json.envs || json
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (PATCH in place)" : "DRY RUN (read-only)"}\n`)
  let planned = 0
  let applied = 0

  for (const { name, vals } of PROJECTS) {
    console.log(`=== ${name} ===`)
    const records = listEnv(name)
    for (const rec of records) {
      if (!(rec.key in vals)) continue
      const target = Array.isArray(rec.target) ? rec.target.join("/") : String(rec.target)
      const newValue = vals[rec.key]
      planned++
      console.log(`  ${rec.key} [${target}] → ${newValue}`)
      if (APPLY) {
        // Partial update: value only; target/type/id preserved.
        api(`/v9/projects/${name}/env/${rec.id}`, "PATCH", { value: newValue })
        applied++
      }
    }
    console.log("")
  }

  console.log(`Planned record updates: ${planned}${APPLY ? ` · applied: ${applied}` : ""}`)
  if (!APPLY) console.log("Re-run with --apply to write these values. Deploy only after secrets are set.")
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
