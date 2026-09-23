#!/usr/bin/env node
// Idempotent Auth0 Post-Login Action deploy for the two NEW TEMP tenants.
// =============================================================================
// Fixes the "Dashboard Monaco editor mangled the pasted code" failure mode by
// uploading the emitted action source over the Management API (never the
// browser editor), deploying it, binding it to the post-login flow, and then
// reading the code back to verify a byte-exact SHA-256 match.
//
//   UK      sbd-uk-temp1.uk.auth0.com   ← out/add-sbd-claims.uk.js
//   Europe  sbd-emea-temp1.eu.auth0.com ← out/add-sbd-claims.emea.js
//
// STRICT two-tenant guard: reuses assertMutableTarget so this can only ever
// write to the two verified hosts; old/rejected/stray tenants, arbitrary
// --domain overrides, and cross-target hosts are refused before any call.
// A second content guard refuses a file whose GENERATED header does not match
// the named tenant+domain, or that still carries __SET_AFTER_APPLY__
// placeholders (emitted before --apply).
//
// Reads Auth0 auth from AUTH0_MGMT_TOKEN (per tenant; never on the CLI/committed).
// SBD_API_AUDIENCE is OPTIONAL: pass --audience <id> (or env SBD_API_AUDIENCE)
// only if a custom SBD API is configured; the action no-ops its custom-claim
// namespace when absent.
//
// Usage:
//   AUTH0_MGMT_TOKEN=<uk>     node deploy-actions.mjs --tenant uk         # dry run
//   AUTH0_MGMT_TOKEN=<uk>     node deploy-actions.mjs --tenant uk --apply
//   AUTH0_MGMT_TOKEN=<europe> node deploy-actions.mjs --tenant europe --apply
// Options:
//   --file <path>       override the emitted source path
//   --name <name>       action name (default: add-sbd-claims)
//   --action-id <id>    update THIS existing action id (e.g. the mangled EU one)
//   --audience <id>     set the SBD_API_AUDIENCE action secret (optional)
//   --apply             actually create/update/deploy/bind (default: dry run)
//
// Management API scopes required: read:actions update:actions create:actions
//   delete:actions (only if you later prune) — plus the bindings are covered by
//   update:actions.

import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, join, isAbsolute } from "node:path"
import { parseArgs, resolveDomain, resolveToken, assertMutableTarget, mgmtFetch } from "./mgmt.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))

// tenant → { expected assertMutableTarget key, emitted file suffix, header marker }
const TENANT_META = {
  uk: { key: "uk", file: "add-sbd-claims.uk.js", marker: "GENERATED for the UK tenant" },
  europe: { key: "europe", file: "add-sbd-claims.emea.js", marker: "GENERATED for the Europe tenant" },
  emea: { key: "europe", file: "add-sbd-claims.emea.js", marker: "GENERATED for the Europe tenant" },
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex")

async function pickPostLoginVersion(domain, token) {
  try {
    const body = await mgmtFetch(domain, token, "/actions/triggers")
    const triggers = (body?.triggers || []).filter((t) => t.id === "post-login")
    if (triggers.length === 0) return "v3"
    const current = triggers.find((t) => String(t.status).toUpperCase() === "CURRENT")
    if (current?.version) return current.version
    // Fall back to the lexically-highest version (v3 > v2 > v1).
    return triggers.map((t) => t.version).filter(Boolean).sort().at(-1) || "v3"
  } catch {
    return "v3"
  }
}

async function main() {
  const args = parseArgs()
  const apply = Boolean(args.apply)
  const tenantArg = String(args.tenant || "").toLowerCase()
  const meta = TENANT_META[tenantArg]
  if (!meta) {
    throw new Error('Specify --tenant uk | --tenant europe.')
  }

  const domain = resolveDomain(args)
  // Hard guard: only the one verified host for this tenant is writable.
  assertMutableTarget(domain, meta.key)
  const token = resolveToken()

  const name = String(args.name || "add-sbd-claims")
  const filePath = args.file
    ? isAbsolute(String(args.file))
      ? String(args.file)
      : join(process.cwd(), String(args.file))
    : join(HERE, "out", meta.file)

  const code = await readFile(filePath, "utf8").catch(() => {
    throw new Error(
      `Cannot read action source at ${filePath}. Emit it first with ` +
        `\`node setup-${meta.key === "uk" ? "uk" : "emea"}.mjs --apply --emit-action\`.`,
    )
  })

  // Content guard: the file's GENERATED header must name THIS tenant + domain,
  // and must not still contain post-apply placeholders.
  const head = code.slice(0, 400)
  if (!head.includes(meta.marker)) {
    throw new Error(
      `Refusing to deploy: ${filePath} header does not contain "${meta.marker}". ` +
        `This looks like the wrong tenant's file.`,
    )
  }
  if (!head.includes(domain)) {
    throw new Error(
      `Refusing to deploy: ${filePath} header does not reference ${domain}. ` +
        `Re-emit it against the correct tenant.`,
    )
  }
  if (code.includes("__SET_AFTER_APPLY__")) {
    throw new Error(
      `Refusing to deploy: ${filePath} still has __SET_AFTER_APPLY__ placeholders. ` +
        `Re-run the setup script with --apply --emit-action so client IDs are populated.`,
    )
  }

  const localSha = sha256(code)
  console.log(`Tenant:   ${tenantArg} (${domain})`)
  console.log(`Action:   ${name}`)
  console.log(`Source:   ${filePath}`)
  console.log(`Local:    ${code.length} bytes · sha256 ${localSha.slice(0, 16)}…`)
  console.log(`Mode:     ${apply ? "APPLY" : "DRY RUN (read-only)"}`)

  const audience = args.audience ? String(args.audience) : process.env.SBD_API_AUDIENCE || ""
  const secrets = audience ? [{ name: "SBD_API_AUDIENCE", value: audience }] : []
  if (audience) console.log(`Secret:   SBD_API_AUDIENCE (set; value not shown)`)

  // 1) Locate the target action (explicit id, else by exact name).
  let action = null
  if (args["action-id"]) {
    action = await mgmtFetch(domain, token, `/actions/actions/${args["action-id"]}`).catch(() => null)
    if (!action) throw new Error(`No action with id ${args["action-id"]} on ${domain}.`)
  } else {
    const found = await mgmtFetch(domain, token, `/actions/actions?actionName=${encodeURIComponent(name)}`)
    action = (found?.actions || []).find((a) => a.name === name) || null
  }

  if (!apply) {
    console.log(
      action
        ? `\nPlan: PATCH code of existing action ${action.id}, deploy, ensure post-login binding.`
        : `\nPlan: CREATE action "${name}" (post-login), deploy, add post-login binding.`,
    )
    console.log("Re-run with --apply to execute. A byte-exact SHA read-back runs after deploy.")
    return
  }

  // 2) Create or update the action code.
  if (action) {
    await mgmtFetch(domain, token, `/actions/actions/${action.id}`, {
      method: "PATCH",
      body: JSON.stringify(secrets.length ? { code, secrets } : { code }),
    })
    console.log(`\nUpdated action ${action.id} code.`)
  } else {
    const version = await pickPostLoginVersion(domain, token)
    action = await mgmtFetch(domain, token, "/actions/actions", {
      method: "POST",
      body: JSON.stringify({
        name,
        supported_triggers: [{ id: "post-login", version }],
        code,
        dependencies: [],
        ...(secrets.length ? { secrets } : {}),
      }),
    })
    console.log(`\nCreated action ${action.id} (post-login ${version}).`)
  }

  // 3) Deploy the current draft.
  // Note: the POST /deploy response body reports deployed=false immediately (the
  // freshly created version object, before the deploy settles). Do NOT trust it.
  // Authoritative status comes from the follow-up GET on the action below.
  const deployVersion = await mgmtFetch(domain, token, `/actions/actions/${action.id}/deploy`, { method: "POST" })

  // 4) Read the action back: verify a byte-exact code match AND confirm the
  //    deploy actually landed (all_changes_deployed + deployed_version pinned).
  const readBack = await mgmtFetch(domain, token, `/actions/actions/${action.id}`)
  const deployedVersionId = readBack?.deployed_version?.id
  const currentVersionId = readBack?.current_version?.id
  const isDeployed = Boolean(
    readBack?.all_changes_deployed &&
      readBack?.deployed_version?.deployed &&
      deployedVersionId &&
      deployedVersionId === currentVersionId,
  )
  console.log(
    `Deployed version ${deployVersion?.id || deployedVersionId || "(unknown)"} · ` +
      `deployed=${isDeployed}` +
      (isDeployed ? "" : " (deploy not yet settled — re-check with GET /actions/actions/" + action.id + ")"),
  )
  const remoteSha = sha256(readBack?.code || "")
  const match = remoteSha === localSha
  console.log(
    `Read-back: ${String(readBack?.code || "").length} bytes · sha256 ${remoteSha.slice(0, 16)}… · ` +
      `${match ? "MATCH ✓" : "MISMATCH ✗"}`,
  )
  if (!match) {
    throw new Error(
      "Read-back SHA does not match the local source. The deployed code differs — do NOT rely on it. " +
        "Re-run --apply; if it persists, inspect the action via GET /api/v2/actions/actions/" + action.id + ".",
    )
  }

  // 5) Ensure the action is bound to the post-login flow (idempotent, order-preserving).
  const current = await mgmtFetch(domain, token, "/actions/triggers/post-login/bindings")
  const bindings = current?.bindings || []
  const already = bindings.some((b) => b?.action?.id === action.id)
  if (already) {
    console.log(`Binding:   already bound to post-login (${bindings.length} binding(s)).`)
  } else {
    const next = [
      ...bindings.map((b) => ({
        ref: { type: "action_id", value: b.action.id },
        display_name: b.display_name || b.action?.name || "action",
      })),
      { ref: { type: "action_id", value: action.id }, display_name: name },
    ]
    await mgmtFetch(domain, token, "/actions/triggers/post-login/bindings", {
      method: "PATCH",
      body: JSON.stringify({ bindings: next }),
    })
    console.log(`Binding:   added to post-login (now ${next.length} binding(s)).`)
  }

  console.log(
    "\n" +
      JSON.stringify(
        { tenant: tenantArg, domain, actionId: action.id, deployed: isDeployed, deployedVersionId, currentVersionId, localSha, remoteSha, match, bound: true },
        null,
        2,
      ),
  )
  console.log("\nDONE — action deployed, byte-verified, and bound to post-login.")
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
