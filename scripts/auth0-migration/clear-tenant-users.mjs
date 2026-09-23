// Destructive: delete users from a TEMP tenant's database. DRY-RUN BY DEFAULT.
// ============================================================================
// Scope is strictly USER/DATABASE records. It never touches applications,
// connections, actions, or secrets — deleting a user leaves all of those intact.
// Deleting a primary user in Auth0 also removes its linked (secondary)
// identities, which is the intended behavior for the Model 2 linked test
// accounts.
//
//   export AUTH0_MGMT_TOKEN='...'
//   node clear-tenant-users.mjs --tenant uk                 # DRY RUN: lists targets, deletes nothing
//   node clear-tenant-users.mjs --tenant uk --connection sbd-demo-per-email   # limit to one connection
//   node clear-tenant-users.mjs --tenant uk --apply         # EXECUTE deletions
//
// Requires token scope: read:users, delete:users.
//
// Clearing the full user DB of BOTH TEMP tenants is pre-authorized by the user.
// The dry run still prints any REVIEW-flagged record (see inventory-users.mjs)
// so a non-test record is caught before --apply.

import { parseArgs, resolveDomain, resolveToken, paginate, mgmtFetch } from "./mgmt.mjs"

const TEST_EMAIL_DOMAINS = new Set([
  "bowlfuel.com", "mailinator.com", "example.com", "example.org", "test.com",
  "sharklasers.com", "guerrillamail.com", "yopmail.com", "10minutemail.com", "inbox.testmail.app",
])
const TEST_HINTS = [/^sbd-demo-/i, /giledos/i, /kexomi/i, /\+tmp/i, /^test/i, /qa\d*/i]

function looksTest(u) {
  const email = String(u.email || "").toLowerCase()
  const domain = email.split("@")[1] || ""
  return (
    TEST_EMAIL_DOMAINS.has(domain) ||
    TEST_HINTS.some((re) => re.test(email) || re.test(u.username || "") || re.test(u.name || ""))
  )
}

const connectionsOf = (u) =>
  [...new Set((Array.isArray(u.identities) ? u.identities : []).map((i) => i.connection).filter(Boolean))]

async function main() {
  const args = parseArgs()
  const domain = resolveDomain(args)
  const token = resolveToken()
  const apply = Boolean(args.apply)
  const onlyConnection = args.connection ? String(args.connection) : null

  let users = await paginate(domain, token, "/users")
  if (onlyConnection) users = users.filter((u) => connectionsOf(u).includes(onlyConnection))

  const review = users.filter((u) => !looksTest(u))
  process.stderr.write(`\nTenant ${domain}${onlyConnection ? ` (connection=${onlyConnection})` : ""}\n`)
  process.stderr.write(`Target users: ${users.length}  |  REVIEW (not obviously test): ${review.length}\n`)
  for (const u of review) {
    process.stderr.write(`  REVIEW  ${u.email || "(no email)"}  [${connectionsOf(u).join(",") || "none"}]  ${u.user_id}\n`)
  }

  if (!apply) {
    process.stderr.write(`\nDRY RUN — nothing deleted. Would delete ${users.length} user(s).\n`)
    process.stderr.write(`Re-run with --apply to execute.\n\n`)
    for (const u of users) process.stdout.write(`WOULD DELETE  ${(u.email || "(no email)").padEnd(40)} ${u.user_id}\n`)
    return
  }

  process.stderr.write(`\nAPPLYING — deleting ${users.length} user(s)...\n`)
  let ok = 0
  let failed = 0
  for (const u of users) {
    try {
      await mgmtFetch(domain, token, `/users/${encodeURIComponent(u.user_id)}`, { method: "DELETE" })
      ok++
      process.stdout.write(`DELETED  ${(u.email || "(no email)").padEnd(40)} ${u.user_id}\n`)
    } catch (e) {
      failed++
      process.stdout.write(`FAILED   ${(u.email || "(no email)").padEnd(40)} ${u.user_id}  ${e.message}\n`)
    }
  }
  process.stderr.write(`\nDone. deleted=${ok} failed=${failed}\n\n`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e.message}\n`)
  process.exit(1)
})
