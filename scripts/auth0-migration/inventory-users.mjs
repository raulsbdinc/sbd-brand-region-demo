// Read-only user inventory for a TEMP tenant.
// ===========================================
// Enumerates every user, records connection(s), linked-identity count, whether
// the profile carries credential_bindings, and flags records that do NOT look
// like disposable test data ("REVIEW"). Makes ZERO writes.
//
//   export AUTH0_MGMT_TOKEN='...'
//   node inventory-users.mjs --tenant uk            # table to stderr, JSON to stdout
//   node inventory-users.mjs --tenant uk --json > uk-users.json
//
// Requires token scope: read:users.

import { parseArgs, resolveDomain, resolveToken, paginate } from "./mgmt.mjs"

// Domains commonly used for throwaway QA mailboxes in this project's testing.
// Anything OUTSIDE this list is surfaced as REVIEW so the operator can eyeball
// it before a destructive clear — even though clearing the full TEMP user DB is
// pre-authorized.
const TEST_EMAIL_DOMAINS = new Set([
  "bowlfuel.com",
  "mailinator.com",
  "example.com",
  "example.org",
  "test.com",
  "sharklasers.com",
  "guerrillamail.com",
  "yopmail.com",
  "10minutemail.com",
  "inbox.testmail.app",
])

// Known seeded test-account local-parts / usernames observed in this chat.
const TEST_HINTS = [/^sbd-demo-/i, /giledos/i, /kexomi/i, /\+tmp/i, /^test/i, /qa\d*/i]

function classify(user) {
  const email = String(user.email || "").toLowerCase()
  const domain = email.split("@")[1] || ""
  const looksTest =
    TEST_EMAIL_DOMAINS.has(domain) ||
    TEST_HINTS.some((re) => re.test(email) || re.test(user.username || "") || re.test(user.name || ""))
  return looksTest ? "test" : "REVIEW"
}

function connectionsOf(user) {
  const ids = Array.isArray(user.identities) ? user.identities : []
  return [...new Set(ids.map((i) => i.connection).filter(Boolean))]
}

async function main() {
  const args = parseArgs()
  const domain = resolveDomain(args)
  const token = resolveToken()
  const users = await paginate(domain, token, "/users")

  const rows = users.map((u) => ({
    user_id: u.user_id,
    email: u.email || null,
    email_verified: Boolean(u.email_verified),
    connections: connectionsOf(u),
    linked_identities: Array.isArray(u.identities) ? u.identities.length : 0,
    has_credential_bindings: Boolean(u.app_metadata?.credential_bindings?.length),
    last_login: u.last_login || null,
    created_at: u.created_at || null,
    classification: classify(u),
  }))

  const review = rows.filter((r) => r.classification === "REVIEW")

  // Human summary → stderr (so stdout stays clean JSON when piped).
  const byConn = {}
  for (const r of rows) for (const c of r.connections.length ? r.connections : ["(none)"]) byConn[c] = (byConn[c] || 0) + 1
  process.stderr.write(`\nTenant ${domain}: ${rows.length} users\n`)
  process.stderr.write(`By connection: ${JSON.stringify(byConn)}\n`)
  process.stderr.write(`Flagged REVIEW (not obviously test data): ${review.length}\n`)
  for (const r of review) {
    process.stderr.write(`  REVIEW  ${r.email || "(no email)"}  [${r.connections.join(",") || "none"}]  last_login=${r.last_login || "never"}\n`)
  }
  process.stderr.write("\n")

  if (args.json) {
    process.stdout.write(JSON.stringify({ domain, count: rows.length, byConnection: byConn, users: rows }, null, 2) + "\n")
  } else {
    for (const r of rows) {
      process.stdout.write(
        `${r.classification.padEnd(6)} ${(r.email || "(no email)").padEnd(40)} ${r.connections.join(",").padEnd(28)} links=${r.linked_identities} bindings=${r.has_credential_bindings ? "Y" : "n"} ${r.user_id}\n`,
      )
    }
  }
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`)
  process.exit(1)
})
