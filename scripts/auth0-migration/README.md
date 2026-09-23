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

| Tenant | Issuer | Region | Owner | Apps | DB connections | Users |
|---|---|---|---|---|---|---|
| **Europe target** (NEW EU-region — pending) | *verified EU issuer, e.g. `sbd-emea-eu-temp.eu.auth0.com`* | **EU** (`eu-west-1`) | `+tmp3@sbdinc.com` | Default App only (fresh) | default only | **0** |
| **REJECTED** `sbd-emea-temp` | `https://sbd-emea-temp.us.auth0.com/` | **US-5** ⛔ | `+tmp3@sbdinc.com` | Default App only | default only | **0** |
| **UK target** `sbd-uk-temp` | `https://sbd-uk-temp.uk.auth0.com/` | UK | `+tmp@sbdinc.com` | Account Management (M2M), DeWalt UK, Stanley UK (+ Default App) | `sbd-demo-dewalt`, `sbd-demo-per-email`, `sbd-demo-stanley` (+ default) | ~20 over 2 pages |
| **Stray (do NOT use)** `sbd-eu-temp` | — | EU-2 | `+tmp2@sbdinc.com` | — | — | — |

Key facts:

- **Europe target must be a NEW EU-region tenant.** The published CIAM-14 Region
  Atlas (Okta Compliance Regions layer,
  `https://mini-app-redesign-ciam-v0.vercel.app/`) maps **France/Germany → EMEA
  hosted in Europe (EU, `eu-west-1` Ireland)** and **UK → United Kingdom (UK,
  `eu-west-2` London)**. Auth0 cannot change a tenant's region and a deleted
  tenant name cannot be reused, so the correct Europe target is a fresh
  EU-region tenant (working name `sbd-emea-eu-temp`). Its exact issuer is
  supplied at run time via `--domain` / `AUTH0_EUROPE_DOMAIN` — **never inferred
  from the name.**
- **`sbd-emea-temp` (US-5) is REJECTED and must NOT be mutated.** Its residency
  conflicts with the CIAM-14 map. `mgmt.mjs`/`setup-emea.mjs` refuse it outright.
- **Stray `sbd-eu-temp` (EU-2, `+tmp2`) is out of scope.** The earlier Cursor
  migration created/configured it under a different owner; leave it alone.
- **Europe starts empty (zero users, Default App only)** — Models 1 & 2 require
  the shared DB connection + the three EU storefront apps + an **M2M app for the
  Management API** + the claims action to be **created**, not just re-pointed in
  Vercel env. (Model 2 "linked Google" also needs a `google-oauth2` social
  connection enabled on the three apps — a manual step; it needs external Google
  OAuth secrets and is not scripted.)
- **UK is already provisioned** (three custom DB connections + both storefront
  apps + M2M) and holds ~20 live test records to clear.

---

## 2. Code / deployment references (read-only, verified this session)

- **Branch:** `main` @ commit `b615c89` — this is the **merge commit of PR #61**
  (cross-brand guard); it also contains PR #60 429-retry `lib/management-retry.ts`
  and PR #59 DeWalt UK per-email drawer. (The earlier `c18fb96` predated PR #61.)
  This runbook lives on the working branch `v0/ciam-auth0-temp-migration-runbook`,
  based directly on `b615c89`.
- **SDK wiring:** `lib/auth0.ts` — callback route `/auth/callback`, logout to
  origin, base URL inferred from request host.
- **Storefront env model — verified live keys (names only, read this session):**
  each storefront is its own single-tenant Vercel project and reads the **base**
  vars, **not** the `_EMEA`/`_UK`-suffixed ones. `lib/auth0-regions.ts` treats
  `AUTH0_DOMAIN_EMEA` etc. only as an optional override that **falls back to the
  base vars**, so the cutover means setting the base keys:
  - **All five:** `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
    `AUTH0_CONNECTION`, `NEXT_PUBLIC_AUTH0_CONNECTION`, `AUTH0_SECRET`,
    `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`,
    `AUTH0_SHARED_CONNECTION`, `AUTH0_SHARED_CONNECTION_ID`.
  - **UK only (extra):** `AUTH0_DEWALT_CONNECTION(_ID)`,
    `AUTH0_STANLEY_CONNECTION(_ID)`, `AUTH0_PER_EMAIL_CONNECTION(_ID)`,
    `AUTH0_PASSWORDLESS_EMAIL_CONNECTION`.
  - Connection-name resolution precedence: `AUTH0_SHARED_CONNECTION →
    AUTH0_CONNECTION → NEXT_PUBLIC_AUTH0_CONNECTION`. Whatever shared connection
    name is created on the Europe tenant (`setup-emea.mjs` default `sbd-emea`,
    overridable via `AUTH0_EUROPE_CONNECTION`) **must be written into these three
    name vars** on the EU projects.
  - `AUTH0_MGMT_CLIENT_ID/SECRET` point at each tenant's **M2M app**; Model 2
    (getUserByEmail / linkIdentity) uses the Management API from the app, so the
    Europe tenant needs its own M2M app (now provisioned by `setup-emea.mjs`).
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
| `mgmt.mjs` | Shared Management API helper (token from `AUTH0_MGMT_TOKEN`, 429/5xx retry, pagination, domain resolution). Rejects the US-5 Europe tenant; UK stays hard-coded. Not executable on its own. | — |
| `inventory-users.mjs` | **Read-only** user census per tenant; flags non-test records as `REVIEW`. | read-only |
| `clear-tenant-users.mjs` | Deletes **user/database records only**; never apps/connections/actions/secrets. `--apply` **fails closed** if any REVIEW record is not named in `--allow-review` / `--allow-review-file`. | **dry run** |
| `setup-emea.mjs` | On the Europe tenant (via `--domain`/`AUTH0_EUROPE_DOMAIN`): creates the shared DB connection + 3 EU web apps (with password-realm + passwordless/otp grants) + the M2M app and its Management API grant; `--emit-action` writes a claims-action copy with `DEMO_SITES_BY_CLIENT_ID` actually populated. | **dry run** |

Token per tenant: Dashboard → Applications → APIs → Auth0 Management API → API
Explorer. Scopes: inventory `read:users`; clear `read:users delete:users`;
setup `read/create:connections read/create/update:clients
read/create:client_grants`. Tokens are short-lived; never commit or pass them
on the command line.

---

## 4. Proposed sequence (execute only after region sign-off)

**Phase A — Inventory (read-only, safe now)**
1. `AUTH0_MGMT_TOKEN=<uk> node inventory-users.mjs --tenant uk --json > uk-users.json`
2. `AUTH0_MGMT_TOKEN=<emea> node inventory-users.mjs --tenant emea` (expect 0)
3. Review every `REVIEW`-flagged UK row. Report any non-test record before any
   deletion.

**Phase B — Europe provisioning** (blocked on the verified EU-region domain)
4. `AUTH0_EUROPE_DOMAIN=<eu-host> AUTH0_MGMT_TOKEN=<europe> node setup-emea.mjs`
   → inspect the dry-run plan (or pass `--domain <eu-host>`).
5. `... node setup-emea.mjs --apply --emit-action` → create the shared
   connection + 3 web apps + M2M app + Management API grant, emit
   `out/add-sbd-claims.emea.js` (client-ID map already populated).
6. Manually deploy the Post-Login action on Europe from the emitted file; set
   the action's `SBD_API_AUDIENCE` secret. Enable the `google-oauth2` social
   connection on the 3 apps (SBD Google OAuth creds) for Model 2 "linked Google".
7. Set the **base** storefront Vercel env vars for `sbd-demo-dewalt-fr`, `-de`,
   `sbd-demo-stanley-fr` (these projects do **not** use `_EMEA` suffixes):
   `AUTH0_DOMAIN` (= the EU host), `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`
   (per app), `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET` (the new M2M
   app), and the shared-connection name/id vars `AUTH0_CONNECTION`,
   `AUTH0_SHARED_CONNECTION`, `AUTH0_SHARED_CONNECTION_ID`,
   `NEXT_PUBLIC_AUTH0_CONNECTION` (all = the connection `setup-emea.mjs`
   created). Keep `AUTH0_SECRET`. Redeploy.

**Phase C — Cleanup (pre-authorized for both TEMP user DBs)**
8. `AUTH0_MGMT_TOKEN=<uk> node clear-tenant-users.mjs --tenant uk` (dry run).
9. `... --apply` once the dry run is clean. Optionally scope with
   `--connection <name>`. Apps/connections/actions/secrets are untouched.
10. EMEA has 0 users — clear is a no-op there.

**Phase D — Acceptance** (supervisor, in-browser, against the live sites)
11. Re-run the Model 1–4 behaviors below on the actual storefronts.

---

## 5. Ticket → acceptance mapping (what "still works live" means)

- **CIAM-12** Model 3 (UK per-email): a second email on the same account gets an
  **independent** password and reset; both emails sign into the **same** profile;
  crossed passwords fail. No duplicate profile.
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

- **Residency:** the US-5 `sbd-emea-temp` conflicts with the CIAM-14 map and is
  **rejected** — provisioning must target the new EU-region tenant. Blocking
  risk until its verified domain is supplied. The new domain also means the
  enveloped Vercel `AUTH0_DOMAIN` etc. must be re-set (never read back).
- **Claims action coupling:** the action is keyed by client ID + needs
  `SBD_API_AUDIENCE`. New EMEA client IDs without the updated map/secret ⇒
  storefront claims silently missing ⇒ brand/market resolution breaks.
- **Linked-identity deletion:** deleting a Model 2 primary also removes its
  secondary identities (intended). A `REVIEW`-flagged primary would take its
  links with it — hence the mandatory REVIEW pass before `--apply`.
- **Wrong-tenant action:** `sbd-eu-temp` (EU-2, `+tmp2`) and `sbd-emea-temp`
  (US-5) are lookalikes. UK is the only hard-coded domain; the Europe domain is
  supplied explicitly and the US-5 host is refused outright, so no script can
  silently hit the wrong Europe tenant.
- **Sensitive Vercel vars:** domains/secrets can only be *set*, not read back;
  keep the source of truth in the dashboards, not in code.
- **Owner split:** EMEA (`+tmp3`) and UK (`+tmp`) are different logins; a token
  minted for one tenant will 401 against the other.
