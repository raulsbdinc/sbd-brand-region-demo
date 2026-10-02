// Align the Auth0 password policy on the four Model 4 brand database
// connections ONLY to the single demo rule (see lib/password-policy.ts):
//   8+ characters, lowercase, uppercase, special, numbers optional,
//   over-long passwords rejected (never truncated), no profile-data or
//   dictionary checks.
// Operational tool, run by hand; not part of the Next.js build.
//
// Targets (hard allow-list, nothing else is ever written):
//   europe  sbd-emea-temp1.eu.auth0.com  sbd-emea-dewalt, sbd-emea-stanley
//   uk      sbd-uk-temp1.uk.auth0.com    sbd-demo-dewalt, sbd-demo-stanley
//
// Credentials: TEMPORARY client-credentials values from an EXISTING app, one
// per tenant, consumed from env only (never printed). Required Management API
// scopes: read:connections, update:connections, read:connections_options,
// update:connections_options.
//   AUTH0_POLICY_EU_CLIENT_ID / AUTH0_POLICY_EU_CLIENT_SECRET
//   AUTH0_POLICY_UK_CLIENT_ID / AUTH0_POLICY_UK_CLIENT_SECRET
//
// Usage:
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/auth0-migration/set-password-policy.mjs              # dry run (read-only)
//   ... set-password-policy.mjs --apply                           # write + readback
//   ... --tenant europe|uk                                        # limit to one tenant
//
// Safety:
//   - Auth0 PATCH replaces `options` wholesale, so the script sends back the
//     COMPLETE options object it just read with only the policy fields below
//     changed, and requires readback of every other option to be deep-equal.
//   - Refuses to write when options look redacted, the strategy isn't "auth0",
//     or the connection carries masked custom-DB configuration.
//   - Never touches enabled clients, users, passwords or any other connection.

import { assertMutableTarget, mgmtFetch, parseArgs } from "./mgmt.mjs"

export const TARGET_COMPLEXITY = Object.freeze({
  min_length: 8,
  character_types: ["lowercase", "uppercase", "special"],
  character_type_rule: "all",
  identical_characters: "allow",
  sequential_characters: "allow",
  max_length_exceeded: "error",
})

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

/** Non-secret summary of every password-policy field, for dry run and readback. */
export function policySummary(options) {
  const o = options ?? {}
  return {
    passwordPolicy: o.passwordPolicy ?? null,
    complexity: o.password_options?.complexity ?? null,
    profile_data_active: o.password_options?.profile_data?.active ?? null,
    dictionary_active: o.password_options?.dictionary?.active ?? null,
    history_active: o.password_options?.history?.active ?? null,
    legacy_complexity: o.password_complexity_options ?? null,
    legacy_no_personal_info: o.password_no_personal_info?.enable ?? null,
    legacy_dictionary: o.password_dictionary?.enable ?? null,
  }
}

// Pure: deep copy of `options` with only the demo-rule fields set.
export function withDemoPolicy(options) {
  const next = structuredClone(options ?? {})
  next.password_options = next.password_options ?? {}
  next.password_options.complexity = {
    ...(next.password_options.complexity ?? {}),
    ...structuredClone(TARGET_COMPLEXITY),
  }
  if (next.password_options.profile_data) next.password_options.profile_data.active = false
  else next.password_options.profile_data = { active: false }
  if (next.password_options.dictionary) next.password_options.dictionary.active = false
  else next.password_options.dictionary = { active: false }
  // Legacy fields: keep them consistent so no older check can be stricter.
  if (next.password_complexity_options) next.password_complexity_options.min_length = TARGET_COMPLEXITY.min_length
  if (next.password_no_personal_info) next.password_no_personal_info.enable = false
  if (next.password_dictionary) next.password_dictionary.enable = false
  return next
}

function stripPolicyFields(options) {
  const copy = structuredClone(options ?? {})
  if (copy.password_options) {
    delete copy.password_options.complexity
    if (copy.password_options.profile_data) delete copy.password_options.profile_data.active
    if (copy.password_options.dictionary) delete copy.password_options.dictionary.active
    for (const k of ["profile_data", "dictionary"]) {
      if (copy.password_options[k] && Object.keys(copy.password_options[k]).length === 0) delete copy.password_options[k]
    }
    if (Object.keys(copy.password_options).length === 0) delete copy.password_options
  }
  if (copy.password_complexity_options) {
    delete copy.password_complexity_options.min_length
    if (Object.keys(copy.password_complexity_options).length === 0) delete copy.password_complexity_options
  }
  if (copy.password_no_personal_info) delete copy.password_no_personal_info.enable
  if (copy.password_dictionary) delete copy.password_dictionary.enable
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
  return JSON.stringify(canonical(stripPolicyFields(before))) === JSON.stringify(canonical(stripPolicyFields(after)))
}

export function policyMatches(options) {
  const c = options?.password_options?.complexity
  if (!c) return false
  const types = [...(c.character_types ?? [])].sort().join(",")
  return (
    c.min_length === TARGET_COMPLEXITY.min_length &&
    types === [...TARGET_COMPLEXITY.character_types].sort().join(",") &&
    c.character_type_rule === "all" &&
    c.identical_characters === "allow" &&
    c.sequential_characters === "allow" &&
    c.max_length_exceeded === "error" &&
    options.password_options?.profile_data?.active !== true &&
    options.password_options?.dictionary?.active !== true &&
    options.password_no_personal_info?.enable !== true &&
    options.password_dictionary?.enable !== true
  )
}

export function assertSafeToWrite(connection) {
  if (connection?.strategy !== "auth0") {
    throw new Error(`${connection?.name}: strategy ${connection?.strategy} is not a database connection`)
  }
  const options = connection.options
  if (!options || typeof options !== "object" || Object.keys(options).length < 3) {
    throw new Error(`${connection.name}: options are missing or look redacted (read:connections_options?); refusing to write.`)
  }
  if (options.configuration && Object.keys(options.configuration).length > 0) {
    throw new Error(`${connection.name}: has masked custom-DB configuration; refusing a wholesale options write.`)
  }
}

async function getToken(domain, target) {
  const clientId = process.env[target.clientIdEnv]
  const clientSecret = process.env[target.clientSecretEnv]
  if (!clientId || !clientSecret) throw new Error(`Missing ${target.clientIdEnv} / ${target.clientSecretEnv}`)
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
  if (!res.ok || !body.access_token) throw new Error(`Token request failed on ${domain}: ${res.status} ${body.error ?? ""}`)
  const scopes = String(body.scope ?? "").split(" ")
  const required = ["read:connections", "update:connections", "read:connections_options", "update:connections_options"]
  return { token: body.access_token, missing: required.filter((s) => !scopes.includes(s)) }
}

async function findConnection(domain, token, name) {
  const list = await mgmtFetch(domain, token, `/connections?strategy=auth0&name=${encodeURIComponent(name)}&include_totals=false`)
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
      const head = `[${tenant}] ${name} (${conn.id})`
      console.log(`${head} before ${JSON.stringify(policySummary(conn.options))} matches=${policyMatches(conn.options)}`)
      if (!apply) continue
      assertSafeToWrite(conn)
      const desired = withDemoPolicy(conn.options)
      if (!otherOptionsUnchanged(conn.options, desired)) throw new Error(`${name}: transform changed non-policy options`)
      await mgmtFetch(domain, token, `/connections/${conn.id}`, { method: "PATCH", body: JSON.stringify({ options: desired }) })
      const readback = await mgmtFetch(domain, token, `/connections/${conn.id}`)
      const ok = policyMatches(readback.options)
      const othersOk = otherOptionsUnchanged(conn.options, readback.options)
      console.log(`${head} after  ${JSON.stringify(policySummary(readback.options))} matches=${ok} otherOptionsUnchanged=${othersOk}`)
      if (!ok || !othersOk) failed = true
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
