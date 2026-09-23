# SBD Auth0 TEMP-tenant migration runbook

Operational runbook + scripts for migrating the demo storefronts from the POC
Auth0 tenant onto the two TEMP tenants, and for clearing test users before a
fresh model-acceptance pass. **Nothing here runs at build time or in the app
runtime** — these are hand-run Node ESM tools (Node 18+; the repo runs Node 24).

> Status of this document: **plan + tooling only.** No Auth0 or Vercel mutation
> has been performed. Every script defaults to a dry run and changes nothing
> without `--apply`. No secret values appear in this repo; the operator exports
> a short-lived Management API token at run time.

---

## 1. Verified tenant inventory (from the real dashboards / OIDC discovery)

Domains were read from OIDC discovery in the browser, **not inferred from tenant
names**.

| Tenant | Issuer (verified) | Region | Owner | Apps | DB connections | Users |
|---|---|---|---|---|---|---|
| **EMEA target** `sbd-emea-temp` | `https://sbd-emea-temp.us.auth0.com/` | **US-5** ⚠️ | `+tmp3@sbdinc.com` | Default App only | default only | **0** |
| **UK target** `sbd-uk-temp` | `https://sbd-uk-temp.uk.auth0.com/` | UK | `+tmp@sbdinc.com` | `sbd-demo-dewalt`, `sbd-demo-per-email`, `sbd-demo-stanley` (+ default) | Account Management (M2M), DeWalt UK, Stanley UK (+ Default App) | ~20 over 2 pages |
| **Stray (do NOT use)** `sbd-eu-temp` | — | EU-2 | `+tmp2@sbdinc.com` | — | — | — |

Key facts:

- **`sbd-emea-temp` is the correct Europe target** (not `sbd-eu-temp`). The
  earlier Cursor migration created/configured `sbd-eu-temp`, owned by a
  different account (`+tmp2`). Leave `sbd-eu-temp` alone; it is out of scope.
- **Region conflict (CIAM-15 / CIAM-14):** `sbd-emea-temp` resolves to **US-5**,
  not an EMEA region. This is not merely a name mismatch: the published CIAM-14
  Region Atlas (Okta Compliance Regions layer,
  `https://mini-app-redesign-ciam-v0.vercel.app/`) maps **France/Germany → EMEA
  hosted in Europe (EU, `eu-west-1` Ireland)** and **UK → United Kingdom (UK,
  `eu-west-2` London)**. US-5 therefore **conflicts with the published
  compliance map**, so this is a residency/compliance blocker, not a cosmetic
  one. **User is resolving the region choice.** If the tenant is recreated in an
  EMEA region, its domain changes and every step below that references
  `sbd-emea-temp.us.auth0.com` must be re-pointed. Do not proceed with EMEA
  provisioning until the region is confirmed.
- **EMEA has zero users and only the Default App** — Models 1 & 2 require the
  shared DB connection + the three EU storefront apps + the claims action to be
  **created**, not just re-pointed in Vercel env.
- **UK is already provisioned** (three custom DB connections + both storefront
  apps + M2M) and holds ~20 live test records to clear.

---

## 2. Code / deployment references (read-only, verified this session)

- **Branch:** `main` @ commit `c18fb96` (includes merged PR #61 cross-brand
  guard, PR #60 429-retry `lib/management-retry.ts`, PR #59 DeWalt UK per-email
  drawer). No working branch for this migration yet.
- **SDK wiring:** `lib/auth0.ts` — callback route `/auth/callback`, logout to
  origin, base URL inferred from request host.
- **Region/tenant env model:** `lib/auth0-regions.ts` — per-region
  `AUTH0_DOMAIN_EMEA` / `_CLIENT_ID_EMEA` / `_CLIENT_SECRET_EMEA` (and `_UK`),
  shared `AUTH0_SECRET`. Connection resolution precedence
  `AUTH0_SHARED_CONNECTION → AUTH0_CONNECTION → NEXT_PUBLIC_AUTH0_CONNECTION →
  sbd-eu`.
- **Claims action:** `auth0/actions/add-sbd-claims.js` — Post-Login, keyed by
  storefront **client ID** and reads `SBD_API_AUDIENCE` from action secrets.
  New EMEA apps mint new client IDs, so the action's client-ID map **and** its
  secret must be set on the EMEA tenant.
- **Five storefront Vercel projects (confirmed to exist):**
  `sbd-demo-dewalt-fr`, `sbd-demo-dewalt-de`, `sbd-demo-stanley-fr` (EMEA),
  `sbd-demo-dewalt-uk`, `sbd-demo-stanley-uk` (UK).
- **`AUTH0_DOMAIN*` env vars on those projects are stored as Vercel
  *sensitive* vars** — the API returns them enveloped and they cannot be read
  back. This is why domains were taken from the dashboards. Re-pointing a
  storefront means **setting** these vars, never reading them.

---

## 3. Scripts

| File | Purpose | Default |
|---|---|---|
| `mgmt.mjs` | Shared Management API helper (token from `AUTH0_MGMT_TOKEN`, 429/5xx retry, pagination, domain resolution). Not executable on its own. | — |
| `inventory-users.mjs` | **Read-only** user census per tenant; flags non-test records as `REVIEW`. | read-only |
| `clear-tenant-users.mjs` | Deletes **user/database records only**; never apps/connections/actions/secrets. | **dry run** |
| `setup-emea.mjs` | Creates the shared DB connection + 3 EU apps on `sbd-emea-temp`, enables the connection on them; `--emit-action` writes a claims-action copy with real client IDs. | **dry run** |

Token per tenant: Dashboard → Applications → APIs → Auth0 Management API → API
Explorer. Scopes: inventory `read:users`; clear `read:users delete:users`;
setup `read/create:connections read/create/update:clients`. Tokens are
short-lived; never commit or pass them on the command line.

---

## 4. Proposed sequence (execute only after region sign-off)

**Phase A — Inventory (read-only, safe now)**
1. `AUTH0_MGMT_TOKEN=<uk> node inventory-users.mjs --tenant uk --json > uk-users.json`
2. `AUTH0_MGMT_TOKEN=<emea> node inventory-users.mjs --tenant emea` (expect 0)
3. Review every `REVIEW`-flagged UK row. Report any non-test record before any
   deletion.

**Phase B — EMEA provisioning** (blocked on region decision)
4. `AUTH0_MGMT_TOKEN=<emea> node setup-emea.mjs` → inspect the dry-run plan.
5. `... node setup-emea.mjs --apply --emit-action` → create connection + 3 apps,
   emit `out/add-sbd-claims.emea.js`.
6. Manually deploy the Post-Login action on EMEA using the emitted client-ID
   map; set the action's `SBD_API_AUDIENCE` secret.
7. Set the storefront Vercel env vars (`AUTH0_DOMAIN_EMEA`,
   `_CLIENT_ID_EMEA`, `_CLIENT_SECRET_EMEA`, shared `AUTH0_SECRET`,
   connection name) for `sbd-demo-dewalt-fr`, `-de`, `sbd-demo-stanley-fr`.
   Redeploy.

**Phase C — Cleanup (pre-authorized for both TEMP user DBs)**
8. `AUTH0_MGMT_TOKEN=<uk> node clear-tenant-users.mjs --tenant uk` (dry run).
9. `... --apply` once the dry run is clean. Optionally scope with
   `--connection <name>`. Apps/connections/actions/secrets are untouched.
10. EMEA has 0 users — clear is a no-op there.

**Phase D — Acceptance** (supervisor, in-browser, against the live sites)
11. Re-run the Model 1–4 behaviors below on the actual storefronts.

---

## 5. Ticket → acceptance mapping (what "still works live" means)

- **CIAM-12** Model 2: a verified alternate email gets an independent password;
  both sign into the **same** profile; crossed passwords fail. No duplicate
  profile.
- **CIAM-13** signup sends verification, account stays limited until link/code,
  resend supported (verification gate).
- **CIAM-4** documents the per-email vs per-brand credential boundaries (custom
  linked DB identities in `app_metadata.credential_bindings`).
- **CIAM-15** TEMP-tenant naming/region — record the **EMEA/US-5** discrepancy.
- **CIAM-11** linked Gmail signs into the existing account, no second profile.
- **CIAM-10** duplicate social-first behavior; linking/merge + orphan handling
  documented.
- **CIAM-7** cross-site session behavior — research/root-cause/limitations only;
  auto-login is **not** a POC requirement.
- **CIAM-5** Confluence four-model doc updated post-migration (topology text is
  stale: it says one EU tenant; reality is separate EMEA + UK).
- **CIAM-14** region/compliance map reflects the Okta recommendation. The
  published Region Atlas (Okta Compliance Regions layer) maps FR/DE → EMEA in
  Europe (`eu-west-1` Ireland) and UK → UK (`eu-west-2` London); the current
  `sbd-emea-temp` US-5 residency **conflicts** with that map.

Security invariants to preserve across all models: fail-closed ambiguous
lookup, local sessions, verification gate, duplicate-signup prevention, correct
recovery routing, and Stanley-vs-DeWalt password isolation (crossed brand
password must not sign in).

---

## 6. Risks

- **Residency:** provisioning EMEA on US-5 may violate the compliance intent of
  CIAM-14/15. Blocking risk — do not provision until confirmed. Recreating in
  an EMEA region changes the domain and invalidates the enveloped Vercel vars.
- **Claims action coupling:** the action is keyed by client ID + needs
  `SBD_API_AUDIENCE`. New EMEA client IDs without the updated map/secret ⇒
  storefront claims silently missing ⇒ brand/market resolution breaks.
- **Linked-identity deletion:** deleting a Model 2 primary also removes its
  secondary identities (intended). A `REVIEW`-flagged primary would take its
  links with it — hence the mandatory REVIEW pass before `--apply`.
- **Wrong-tenant action:** `sbd-eu-temp` (EU-2, `+tmp2`) is a lookalike. All
  scripts target `sbd-emea-temp`/`sbd-uk-temp` only, via explicit `--tenant`.
- **Sensitive Vercel vars:** domains/secrets can only be *set*, not read back;
  keep the source of truth in the dashboards, not in code.
- **Owner split:** EMEA (`+tmp3`) and UK (`+tmp`) are different logins; a token
  minted for one tenant will 401 against the other.
