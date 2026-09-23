#!/usr/bin/env node
// Rotate AUTH0_SECRET across the five storefronts to invalidate stale sessions.
// =============================================================================
// The @auth0/nextjs-auth0 v4 session is a single stateless cookie encrypted
// with AUTH0_SECRET (see lib/auth0.ts). The tenant cutover intentionally left
// AUTH0_SECRET unchanged, so a cookie minted against the OLD tenant still
// decrypts and /api/me keeps returning the old identity even though the new
// tenants are empty. Rotating AUTH0_SECRET to a fresh value makes every
// pre-migration cookie undecryptable → the SDK treats the request as logged
// out → the user must re-authenticate against the NEW tenant. This is the
// migration-safe session invalidation.
//
// One NEW shared value is generated in-process and written to all five projects
// (matching the prior shared-secret convention). The value is NEVER printed,
// logged, or passed on argv — it travels to `vercel api` over stdin only. To
// let you confirm all five received the SAME value, a short SHA-256 prefix of
// the new secret is printed (a one-way digest, not the secret).
//
// Safety:
//   • Hardcoded project + env-record id allowlist (the exact AUTH0_SECRET
//     records inventoried on 2026-… ). It refuses to write if the live record
//     at that id is not still keyed AUTH0_SECRET.
//   • Dry run by default; --apply to write. Deploy the five projects AFTER
//     applying so the new secret takes effect.
//
// Usage:
//   node rotate-auth0-secret.mjs           # dry run: verify records, no write
//   node rotate-auth0-secret.mjs --apply   # generate + PATCH all five in place
//
// Reads Vercel auth from the `vercel` CLI (already authenticated in the shell).

import { execFileSync } from "node:child_process"
import { randomBytes, createHash } from "node:crypto"

const TEAM = "team_VyWYz4IZFMxqmNHqJBb3r1kG"
const APPLY = process.argv.includes("--apply")

// Exact AUTH0_SECRET env-record ids per storefront (inventoried live).
const RECORDS = [
  { project: "sbd-demo-dewalt-fr", envId: "Uxf8fgQjmf6dB2Zi" },
  { project: "sbd-demo-dewalt-de", envId: "m3pocYooazbEBNKb" },
  { project: "sbd-demo-stanley-fr", envId: "bpNivYXjnHnV8Xk9" },
  { project: "sbd-demo-dewalt-uk", envId: "rwaSOIWN5navVBPz" },
  { project: "sbd-demo-stanley-uk", envId: "UwkZjivcGxjRLf48" },
]

function api(pathname, method = "GET", body) {
  const args = ["api", pathname, "--scope", TEAM, "--raw"]
  if (method !== "GET") args.push("-X", method)
  const opts = { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  if (body !== undefined) {
    args.push("--input", "-")
    opts.input = JSON.stringify(body) // secret travels over stdin, never argv
  }
  return execFileSync("vercel", args, opts)
}

function findRecord(project, envId) {
  const raw = api(`/v10/projects/${project}/env?decrypt=false`)
  const json = JSON.parse(raw)
  const list = json.envs || json
  return list.find((e) => e.id === envId) || null
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (rotate in place)" : "DRY RUN (verify records only)"}\n`)

  // Verify every target record is still an AUTH0_SECRET before touching anything.
  for (const { project, envId } of RECORDS) {
    const rec = findRecord(project, envId)
    if (!rec) throw new Error(`Refusing: ${project} has no env record ${envId}.`)
    if (rec.key !== "AUTH0_SECRET") {
      throw new Error(`Refusing: ${project} record ${envId} is "${rec.key}", not AUTH0_SECRET.`)
    }
    const target = Array.isArray(rec.target) ? rec.target.join("/") : String(rec.target)
    console.log(`  ${project}: AUTH0_SECRET [${target}] (${rec.type}) ✓`)
  }

  if (!APPLY) {
    console.log("\nAll five records verified. Re-run with --apply to rotate, then redeploy all five.")
    return
  }

  // One fresh shared 32-byte secret (64 hex chars) for all five.
  const secret = randomBytes(32).toString("hex")
  const digest = createHash("sha256").update(secret).digest("hex").slice(0, 12)
  console.log(`\nGenerated new shared AUTH0_SECRET · sha256:${digest} (value not shown)\n`)

  let applied = 0
  for (const { project, envId } of RECORDS) {
    api(`/v9/projects/${project}/env/${envId}`, "PATCH", { value: secret })
    console.log(`  rotated ${project}`)
    applied++
  }

  console.log(
    `\nRotated ${applied}/${RECORDS.length} projects to the same new secret (sha256:${digest}). ` +
      `Redeploy all five now so the new secret takes effect and old-tenant sessions are invalidated.`,
  )
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
