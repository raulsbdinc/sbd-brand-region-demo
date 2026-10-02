// Align the Auth0 database-connection password minimum length to 8 on the four
// Model 4 brand connections ONLY. Operational tool, run by hand; not part of the
// Next.js build.
//
// Targets (hard allow-list, nothing else is ever read for write or written):
//   europe  sbd-emea-temp1.eu.auth0.com  sbd-emea-dewalt, sbd-emea-stanley
//   uk      sbd-uk-temp1.uk.auth0.com    sbd-demo-dewalt, sbd-demo-stanley
//
// Credentials: TEMPORARY client-credentials apps, one per tenant, consumed from
// env only (never printed). Required Management API scopes:
//   read:connections, update:connections,
//   read:connections_options, update:connections_options
//   AUTH0_POLICY_EU_CLIENT_ID / AUTH0_POLICY_EU_CLIENT_SECRET
//   AUTH0_POLICY_UK_CLIENT_ID / AUTH0_POLICY_UK_CLIENT_SECRET
//
// Usage:
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/auth0-migration/set-password-min-length.mjs            # dry run (read-only)
//   ... set-password-min-length.mjs --apply                          # write + readback
//   ... --tenant europe|uk                                           # limit to one tenant
//
// Safety:
//   - Auth0 PATCH replaces `options` wholesale, so the script sends back the
//     COMPLETE options object it just read with only the min-length field(s)
//     changed. It refuses to write if options look redacted/empty (missing
//     read:connections_options scope) or if the connection is not strategy
//     "auth0" or carries custom-DB `configuration` secrets that the API masks.
//   - Readback must show min_length === 8 AND every other option deep-equal to
//     the pre-write snapshot; otherwise it exits non-zero.
//   - Never touches enabled_clients, users, passwords, or any other connection.

import { assertMutableTarget, mgmtFetch, parseArgs } from "./mgmt.mjs"

export const TARGET_MIN_LENGTH = 8

export const POLICY_TARGETS = {
  europe: {
    domain: "sbd-emea-temp1.eu.auth0.com",
    connections: ["sbd-emea-dewalt", "sbd-emea-stanley"],
    clientIdEnv: "AUTH0_POLICY_EU_CLIENT_ID",
    clientSecretEnv: "AUTH0_POLICY_EU_CLIENT_SECRET",
  },
  uk: {
    domain: "sbd-uk-temp1.uk.auth0.com",
    connections: ["sbd-demo-dewalt", "sbd-demo-stanley"],
    clientIdEnv: "AUTH0_POLICY_UK_CLIENT_ID",
    clientSecretEnv: "AUTH0_POLICY_UK_CLIENT_SECRET",
  },
}

export function readMinLength(options) {
  const flexible = options?.password_options?.complexity?.min_length
  const legacy = options?.password_complexity_options?.min_length
  return { flexible: flexible ?? null, legacy: legacy ?? null }
}

// Pure: returns a deep copy of `options` with only the min-length field(s) set.
// If the newer flexible `password_options.complexity` block exists it is the
// authoritative one and is updated; the legacy `password_complexity_options`
// is updated when present, or created when no flexible block exists.
export function withMinLength(options, minLength = TARGET_MIN_LENGTH) {
  const next = structuredClone(options ?? {})
  const hasFlexible = next.password_options?.complexity && typeof next.password_options.complexity === "object"
  if (hasFlexible) {
    next.password_options.complexity.min_length = minLength
  }
  if (next.password_complexity_options || !hasFlexible) {
    next.password_complexity_options = { ...(next.password_complexity_options ?? {}), min_length: minLength }
  }
  return next
}

function stripMinLength(options) {
  const copy = structuredClone(options ?? {})
  if (copy.password_options?.complexity) delete copy.password_options.complexity.min_length
  if (copy.password_complexity_options) {
    delete copy.password_complexity_options.min_length
    if (Object.keys(copy.password_complexity_options).length === 0) delete copy.password_complexity_options
  }
  return copy
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
  }
  return value
}

export function otherOptionsUnchanged(before, after) {
  return JSON.stringify(canonical(stripMinLength(before))) === JSON.stringify(canonical(stripMinLength(after)))
}

export function assertSafeToWrite(connection) {
  if (connection?.strategy !== "auth0") {
    throw new Error(`${connection?.name}: strategy ${connection?.strategy} is not a database connection`)
  }
  const options = connection.options
  if (!options || typeof options !== "object" || Object.keys(options).length < 3) {
    throw new Error(
      `${connection.name}: options are missing or look redacted. The credential likely lacks read:connections_options; refusing to write.`,
    )
  }
  if (options.configuration && Object.keys(options.configuration).length > 0) {
    throw new Error(`${connection.name}: has custom-DB configuration values the API masks; refusing a wholesale options write.`)
  }
}

async function getToken(domain, target) {
  const clientId = process.env[target.clientIdEnv]
  const clientSecret = process.env[target.clientSecretEnv]
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${target.clientIdEnv} / ${target.clientSecretEnv}`)
  }
  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(`Token request failed on ${domain}: ${res.status} ${body.error ?? ""}`)
  }
  const scopes = String(body.scope ?? "").split(" ")
  const required = ["read:connections", "update:connections", "read:connections_options", "update:connections_options"]
  const missing = required.filter((s) => !scopes.includes(s))
  return { token: body.access_token, missing }
}

async function findConnection(domain, token, name) {
  const list = await mgmtFetch(
    domain,
    token,
    `/connections?strategy=auth0&name=${encodeURIComponent(name)}&include_totals=false`,
  )
  const matches = (Array.isArray(list) ? list : list?.connections ?? []).filter((c) => c.name === name)
  if (matches.length !== 1) throw new Error(`${name}: expected exactly one connection, found ${matches.length}`)
  return mgmtFetch(domain, token, `/connections/${matches[0].id}`)
}

async function run() {
  const args = parseArgs()
  const apply = Boolean(args.apply)
  const only = args.tenant ? String(args.tenant).toLowerCase() : null
  const tenants = Object.keys(POLICY_TARGETS).filter((t) => !only || t === only)
  if (tenants.length === 0) throw new Error(`Unknown --tenant ${args.tenant}`)

  let failed = false
  for (const tenant of tenants) {
    const target = POLICY_TARGETS[tenant]
    const domain = assertMutableTarget(target.domain, tenant)
    const { token, missing } = await getToken(domain, target)
    if (missing.length) {
      console.log(`[${tenant}] token missing scopes: ${missing.join(", ")}`)
      if (apply) {
        failed = true
        continue
      }
    }
    for (const name of target.connections) {
      const conn = await findConnection(domain, token, name)
      const before = readMinLength(conn.options)
      const summary = `[${tenant}] ${name} (${conn.id}) passwordPolicy=${conn.options?.passwordPolicy ?? "n/a"} min_length flexible=${before.flexible} legacy=${before.legacy}`
      if (!apply) {
        console.log(`${summary}  (dry run)`)
        continue
      }
      assertSafeToWrite(conn)
      const desired = withMinLength(conn.options)
      if (!otherOptionsUnchanged(conn.options, desired)) throw new Error(`${name}: transform changed more than min_length`)
      await mgmtFetch(domain, token, `/connections/${conn.id}`, {
        method: "PATCH",
        body: JSON.stringify({ options: desired }),
      })
      const readback = await mgmtFetch(domain, token, `/connections/${conn.id}`)
      const after = readMinLength(readback.options)
      const lengthOk =
        (after.flexible === null || after.flexible === TARGET_MIN_LENGTH) &&
        (after.legacy === null || after.legacy === TARGET_MIN_LENGTH) &&
        (after.flexible === TARGET_MIN_LENGTH || after.legacy === TARGET_MIN_LENGTH)
      const othersOk = otherOptionsUnchanged(conn.options, readback.options)
      console.log(
        `${summary} -> readback flexible=${after.flexible} legacy=${after.legacy} lengthOk=${lengthOk} otherOptionsUnchanged=${othersOk}`,
      )
      if (!lengthOk || !othersOk) failed = true
    }
  }
  if (failed) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
