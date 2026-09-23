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
// Confirmed issuers (verified from OIDC discovery in the browser, NOT inferred
// from tenant names):
//   UK      sbd-uk-temp.uk.auth0.com   (region EU/UK — stable target)
//   Europe  provided at run time via --domain or AUTH0_EUROPE_DOMAIN.
//           The verified EU-region tenant (e.g. sbd-emea-eu-temp.eu.auth0.com)
//           REPLACES the rejected US-5 sbd-emea-temp.us.auth0.com, which must
//           NOT be mutated (wrong residency for CIAM-14 / CIAM-15). The Europe
//           domain is deliberately not hard-coded so no script can default to
//           the US-5 tenant.

const TENANT_DOMAINS = {
  uk: "sbd-uk-temp.uk.auth0.com",
}

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
    const fromEnv = process.env.AUTH0_EUROPE_DOMAIN
    if (fromEnv) return String(fromEnv)
    throw new Error(
      "The Europe tenant domain is not hard-coded (the US-5 sbd-emea-temp is rejected for " +
        "CIAM-14 residency). Pass --domain <eu-host> or set AUTH0_EUROPE_DOMAIN to the verified " +
        "EU-region tenant (e.g. sbd-emea-eu-temp.eu.auth0.com).",
    )
  }
  if (TENANT_DOMAINS[tenant]) return TENANT_DOMAINS[tenant]
  throw new Error(
    "Specify the target tenant: --tenant uk, or --tenant europe with --domain/AUTH0_EUROPE_DOMAIN " +
      "(or an explicit --domain <host>).",
  )
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
