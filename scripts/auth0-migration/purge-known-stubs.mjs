// Selective, fail-closed cleanup of TWO known standalone passwordless stubs on
// the UK temp tenant. DRY-RUN BY DEFAULT.
// ============================================================================
// These two IDs are the disposable `email|...` proof stubs left by the pre-fix
// Model 3 / Model 4 flows (now prevented by the pre-consumption gate + success
// -path purge). This tool deletes ONLY these two exact IDs, and ONLY after each
// one independently passes every structural safety check below. It will never
// touch the three canonical UK test profiles.
//
//   export AUTH0_MGMT_TOKEN='...'
//   export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
//   node purge-known-stubs.mjs                 # DRY RUN: inspects + classifies, deletes nothing
//   node purge-known-stubs.mjs --apply         # EXECUTE (only if BOTH targets are ELIGIBLE)
//
// Requires token scope: read:users, delete:users.
//
// SAFETY (all must hold per target, else it is REVIEW and NOTHING is deleted):
//   1. Tenant is the verified UK temp host (assertMutableTarget(..., "uk")).
//   2. The id is one of the two hard-coded TARGET_STUB_IDS — no other id is
//      ever eligible, and any id NOT in this set is refused outright.
//   3. The id is NOT in CANONICAL_ROOTS (explicit deny-list of real profiles).
//   4. GET /users/{id} returns 200 (i.e. it is a live PRIMARY, not a linked
//      secondary — a linked secondary would 404 here).
//   5. The user id begins with "email|" and EVERY identity is passwordless
//      (provider === "email"): no DB (auth0), no social identity.
//   6. No app_metadata.credential_bindings (a real account would carry these).
// `--apply` runs only when BOTH targets are ELIGIBLE; a single REVIEW aborts
// the whole run (fail-closed), deleting nothing.

import {
  parseArgs,
  resolveDomain,
  resolveToken,
  assertMutableTarget,
  mgmtFetch,
} from "./mgmt.mjs"

// The only two ids this tool may ever delete.
const TARGET_STUB_IDS = [
  "email|6ab404ebfca911bc18bf9d71", // Model 3 signup proof stub (sbdciam-uk1-2309)
  "email|6ab40645fca911bc18bfa1d7", // Model 4 cross-brand link proof stub (sbdciam-uk4-2309)
]

// Real profiles that must never be deleted, even if mis-passed.
const CANONICAL_ROOTS = new Set([
  "auth0|6ab405058e93e86fd26df6f6", // Model 3 canonical root (sbdciam-uk1/uk2)
  "auth0|6ab4061131a4e3517a45a32d", // Model 4 canonical root (sbdciam-uk4)
])

function classify(id, user) {
  const reasons = []
  if (!TARGET_STUB_IDS.includes(id)) reasons.push("not in TARGET_STUB_IDS")
  if (CANONICAL_ROOTS.has(id)) reasons.push("id is a CANONICAL_ROOT")
  if (!user) {
    reasons.push("GET /users/{id} did not return a live primary (404/none)")
    return { eligible: false, reasons }
  }
  if (!String(user.user_id || id).startsWith("email|")) reasons.push("id is not an email| passwordless id")
  const identities = Array.isArray(user.identities) ? user.identities : []
  if (identities.length === 0) reasons.push("no identities on record")
  const nonPasswordless = identities.filter((i) => i.provider !== "email")
  if (nonPasswordless.length > 0) {
    reasons.push(`has non-passwordless identity: ${nonPasswordless.map((i) => i.provider).join(",")}`)
  }
  const bindings = user.app_metadata && user.app_metadata.credential_bindings
  if (Array.isArray(bindings) && bindings.length > 0) {
    reasons.push(`has ${bindings.length} credential_bindings (looks like a real account)`)
  }
  return { eligible: reasons.length === 0, reasons }
}

async function getUser(domain, token, id) {
  // mgmtFetch throws on non-2xx. A 404 (linked secondary or already-deleted id)
  // is a legitimate "nothing to delete" outcome we classify, not a crash — so
  // swallow ONLY the 404 and re-throw everything else.
  try {
    return await mgmtFetch(domain, token, `/api/v2/users/${encodeURIComponent(id)}`, {
      method: "GET",
    })
  } catch (err) {
    if (/Management API 404:/.test(String(err && err.message))) return null
    throw err
  }
}

async function main() {
  const args = parseArgs()
  const apply = Boolean(args.apply)
  const domain = resolveDomain({ ...args, tenant: args.tenant || "uk" })
  assertMutableTarget(domain, "uk")
  const token = resolveToken()

  console.error(`# purge-known-stubs — ${apply ? "APPLY" : "DRY RUN"} against ${domain}`)
  console.error(`# candidate ids: ${TARGET_STUB_IDS.join(", ")}\n`)

  const results = []
  for (const id of TARGET_STUB_IDS) {
    const user = await getUser(domain, token, id)
    const { eligible, reasons } = classify(id, user)
    results.push({ id, eligible, reasons, email: user && user.email, connections: user ? (user.identities || []).map((i) => i.connection) : [] })
    const tag = eligible ? "ELIGIBLE" : "REVIEW"
    console.error(`[${tag}] ${id}`)
    console.error(`        email=${(user && user.email) || "(none / 404)"} identities=${JSON.stringify((user && user.identities && user.identities.map((i) => i.provider)) || [])}`)
    if (reasons.length) console.error(`        reasons: ${reasons.join("; ")}`)
  }

  const review = results.filter((r) => !r.eligible)
  const eligible = results.filter((r) => r.eligible)

  if (!apply) {
    console.error(`\n# DRY RUN complete: ${eligible.length} eligible, ${review.length} review. Re-run with --apply to delete the eligible stubs.`)
    console.log(JSON.stringify({ mode: "dry-run", domain, results }, null, 2))
    return
  }

  if (review.length > 0) {
    console.error(`\n# ABORT (fail-closed): ${review.length} target(s) are REVIEW; deleting nothing.`)
    console.log(JSON.stringify({ mode: "apply", applied: false, aborted: true, domain, results }, null, 2))
    process.exitCode = 1
    return
  }

  const deleted = []
  for (const r of eligible) {
    // DELETE returns 204; mgmtFetch returns null on 204 and throws on any error.
    await mgmtFetch(domain, token, `/api/v2/users/${encodeURIComponent(r.id)}`, {
      method: "DELETE",
    })
    console.error(`[DELETED] ${r.id} (${r.email})`)
    deleted.push(r.id)
  }
  console.log(JSON.stringify({ mode: "apply", applied: true, domain, deleted, results }, null, 2))
}

main().catch((err) => {
  console.error(String((err && err.stack) || err))
  process.exit(1)
})
