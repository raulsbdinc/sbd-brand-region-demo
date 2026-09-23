// Shared Auth0 Management API helper for the SBD TEMP-tenant migration scripts.
// =============================================================================
// Dependency-free Node ESM (Node 18+ global fetch). NOT part of the Next.js
// build or tsconfig. These scripts are operational tools run by hand from a
// trusted machine — never wired into the app runtime.
//
// SECRETS: no token or domain is embedded here. The operator exports a
// short-lived Management API token (from the tenant's API Explorer) at run
// time. Nothing is written to the repo.
//
//   export AUTH0_MGMT_TOKEN='...'         # required, never committed
//   node inventory-users.mjs --tenant uk  # domain resolved from --tenant
//
// Confirmed issuers (verified from OIDC discovery in the browser + Auth0 Teams,
// NOT inferred from tenant names). These two NEW tenants are the ONLY migration
// targets:
//   UK      sbd-uk-temp1.uk.auth0.com   (region UK-1, owner +tmp5)
//   Europe  sbd-emea-temp1.eu.auth0.com (region EU-2, owner +tmp4)
//
// Old lookalike tenants are REFUSED as mutation targets by assertMutableTarget()
// (they may still be READ read-only as a config reference — e.g. exporting the
// old UK connection settings — but never provisioned into or cleared):
//   sbd-emea-temp.us.auth0.com  — US-5, CIAM-14 residency conflict
//   sbd-eu-temp.eu.auth0.com    — stray (+tmp2), never in scope
//   sbd-uk-temp.uk.auth0.com    — old UK, reference source only (do not mutate)
//
// Both targets can still be overridden at run time with --domain, or
// AUTH0_UK_DOMAIN / AUTH0_EUROPE_DOMAIN, but default to the verified tenants.

const TENANT_DOMAINS = {
  uk: "sbd-uk-temp1.uk.auth0.com",
  europe: "sbd-emea-temp1.eu.auth0.com",
  emea: "sbd-emea-temp1.eu.auth0.com",
}

// Old/rejected tenants that must never be provisioned into or cleared.
const FORBIDDEN_MUTATION_DOMAINS = new Set([
  "sbd-emea-temp.us.auth0.com",
  "sbd-eu-temp.eu.auth0.com",
  "sbd-uk-temp.uk.auth0.com",
])

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        args[key] = true
      } else {
        args[key] = next
        i++
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

export function resolveDomain(args) {
  if (args.domain) return String(args.domain)
  const tenant = String(args.tenant || "").toLowerCase()
  if (tenant === "emea" || tenant === "europe") {
    return String(process.env.AUTH0_EUROPE_DOMAIN || TENANT_DOMAINS.europe)
  }
  if (tenant === "uk") {
    return String(process.env.AUTH0_UK_DOMAIN || TENANT_DOMAINS.uk)
  }
  throw new Error(
    "Specify the target tenant: --tenant uk | --tenant europe (or an explicit --domain <host>). " +
      "Defaults resolve to the verified new tenants sbd-uk-temp1.uk.auth0.com / " +
      "sbd-emea-temp1.eu.auth0.com; override with AUTH0_UK_DOMAIN / AUTH0_EUROPE_DOMAIN.",
  )
}

// Guard for MUTATING scripts (setup/clear). Read-only inventory may target the
// old UK tenant as a config reference and deliberately does NOT call this.
export function assertMutableTarget(domain) {
  if (FORBIDDEN_MUTATION_DOMAINS.has(domain)) {
    throw new Error(
      `Refusing to mutate ${domain} — it is an old/rejected tenant (US-5 sbd-emea-temp, ` +
        `stray sbd-eu-temp, or reference-only old sbd-uk-temp). The only mutation targets are ` +
        `sbd-emea-temp1.eu.auth0.com and sbd-uk-temp1.uk.auth0.com.`,
    )
  }
  return domain
}

export function resolveToken() {
  const token = process.env.AUTH0_MGMT_TOKEN
  if (!token) {
    throw new Error(
      "Set AUTH0_MGMT_TOKEN to a Management API token for the target tenant " +
        "(Dashboard → Applications → APIs → Auth0 Management API → API Explorer). " +
        "Never pass tokens on the command line or commit them.",
    )
  }
  return token
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retry policy mirrors lib/management-retry.ts intent: honor Retry-After /
// X-RateLimit-Reset on 429, otherwise exponential backoff, capped.
function retryDelayMs(res, attempt) {
  const retryAfter = Number(res.headers.get("retry-after"))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
  const reset = Number(res.headers.get("x-ratelimit-reset"))
  if (Number.isFinite(reset) && reset > 0) {
    const deltaMs = reset * 1000 - Date.now()
    if (deltaMs > 0) return Math.min(deltaMs, 10_000)
  }
  return Math.min(500 * 2 ** attempt, 8_000)
}

/**
 * Management API fetch with 429/5xx retry. Returns parsed JSON (or null for
 * 204). Throws on non-2xx after retries, without leaking the token.
 */
export async function mgmtFetch(domain, token, path, init = {}, maxAttempts = 6) {
  const url = path.startsWith("http")
    ? path
    : `https://${domain}/api/v2${path.startsWith("/") ? path : `/${path}`}`
  let lastErr
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.headers || {}),
        },
      })
    } catch (e) {
      lastErr = e
      await sleep(retryDelayMs({ headers: new Map() }, attempt))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`${res.status} ${res.statusText} on ${path}`)
      await sleep(retryDelayMs(res, attempt))
      continue
    }
    if (res.status === 204) return null
    const text = await res.text()
    const body = text ? JSON.parse(text) : null
    if (!res.ok) {
      const msg = body?.message || body?.error || res.statusText
      throw new Error(`Management API ${res.status}: ${msg} (${init.method || "GET"} ${path})`)
    }
    return body
  }
  throw lastErr || new Error(`Management API request failed: ${path}`)
}

/** Page through a list endpoint that supports page/per_page + include_totals. */
export async function paginate(domain, token, path, { perPage = 100 } = {}) {
  const items = []
  let page = 0
  for (;;) {
    const sep = path.includes("?") ? "&" : "?"
    const url = `${path}${sep}per_page=${perPage}&page=${page}&include_totals=true`
    const body = await mgmtFetch(domain, token, url)
    const batch = Array.isArray(body) ? body : body?.users || body?.clients || body?.connections || []
    items.push(...batch)
    const total = Array.isArray(body) ? batch.length : body?.total ?? items.length
    page++
    if (items.length >= total || batch.length === 0) break
  }
  return items
}
