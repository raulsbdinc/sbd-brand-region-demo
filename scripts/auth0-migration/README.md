# SBD Auth0 TEMP-tenant migration runbook

Operational runbook + scripts for migrating the demo storefronts from the POC
Auth0 tenant onto the two **new, verified** TEMP tenants, and for optionally
clearing test users before a fresh model-acceptance pass. **Nothing here runs at
build time or in the app runtime** — these are hand-run Node ESM tools (Node
18+; the repo runs Node 24).

> Status of this document: **plan + tooling only.** No Auth0 or Vercel mutation
> has been performed by v0. Every script defaults to a dry run and changes
> nothing without `--apply`. No secret values appear in this repo; the operator
> exports a short-lived Management API token at run time.

---

## 1. Verified tenant inventory (from the real dashboards / OIDC discovery)

Domains were read from OIDC discovery in the browser + Auth0 Teams, **not
inferred from tenant names**. The two migration targets are **new, empty
tenants** the user created for this pass.

| Tenant | Issuer | Region | Owner | Apps | DB connections | Users | Role |
|---|---|---|---|---|---|---|---|
| **Europe target** `sbd-emea-temp1` | `https://sbd-emea-temp1.eu.auth0.com/` | **EU-2** ✅ | `+tmp4@sbdinc.com` | Default App only (fresh) | default only | **0** | **MUTATE** |
| **UK target** `sbd-uk-temp1` | `https://sbd-uk-temp1.uk.auth0.com/` | **UK-1** ✅ | `+tmp5@sbdinc.com` | Default App only (fresh) | default only | **0** | **MUTATE** |
| Old UK `sbd-uk-temp` | `https://sbd-uk-temp.uk.auth0.com/` | UK | `+tmp@sbdinc.com` | Account Mgmt (M2M), DeWalt UK, Stanley UK (+ Default) | `sbd-demo-dewalt`, `sbd-demo-per-email`, `sbd-demo-stanley` (+ default) | ~20 | **READ-ONLY reference** |
| **REJECTED** `sbd-emea-temp` | `https://sbd-emea-temp.us.auth0.com/` | **US-5** ⛔ | `+tmp3@sbdinc.com` | Default App only | default only | 0 | do not touch |
| Stray `sbd-eu-temp` | — | EU-2 | `+tmp2@sbdinc.com` | — | — | — | do not touch |

Key facts:

- **Both targets are new, verified, and correctly located.** `sbd-emea-temp1`
  is EU-2 (satisfies the CIAM-14 map's FR/DE → Europe requirement) and
  `sbd-uk-temp1` is UK-1 (UK → United Kingdom). This resolves the earlier US-5
  residency conflict — the US-5 `sbd-emea-temp` is **abandoned** and refused as a
  mutation target.
- **Both targets start empty** (zero users, Default App + default DB connection
  only). The "clean DB before testing" precondition is therefore **already
  satisfied** — no user deletion is required on either target. `clear-tenant-users.mjs`
  remains available purely as a safety tool and is scoped to the two new tenants.
- **Both targets need full provisioning**, not just a Vercel env re-point:
  - **Europe** (`setup-emea.mjs`): shared DB connection + 3 EU web apps
    (DeWalt FR, DeWalt DE, Stanley FR) + M2M app + Management API grant +
    claims action. Models 1 & 2.
  - **UK** (`setup-uk.mjs`): the **three** custom DB connections
    (`sbd-demo-dewalt`, `sbd-demo-per-email`, `sbd-demo-stanley`) + default DB
    connection + passwordless email connection + 2 UK web apps (DeWalt UK,
    Stanley UK) + M2M app + Management API grant + claims action. Models 3 & 4.
- **Old `sbd-uk-temp` is a READ-ONLY configuration reference, not a cleanup
  target.** Its observed settings were used to build `setup-uk.mjs` to parity
  (grants, connections, connection options, callbacks). The mutating scripts
  refuse it.
- **Model 2 "linked Google"** needs a `google-oauth2` social connection enabled
  on the apps (both tenants) — a manual step; it needs external Google OAuth
  secrets and is not scripted.

### Observed old-UK parity captured in `setup-uk.mjs`

Read-only from the old `sbd-uk-temp` dashboard (both UK apps identical):

- **Web-app grants:** `implicit`, `authorization_code`, `refresh_token`,
  `password-realm`, `passwordless/otp`.
- **Enabled connections:** all three custom DB connections,
  `Username-Password-Authentication` (default), `google-oauth2`, passwordless
  email — all enabled on both apps.
- **Custom DB connection options:** Disable Sign Ups **ON**, Improved brute-force
  protection **ON**, Requires Username **OFF**. Registration for these
  connections goes through the **Management API** (Model 3/4 create/link/reset),
  **not** public database signup — `setup-uk.mjs` never enables public signup on
  them.
- **Passwordless email:** OTP expiry **180s**, OTP length **6**, Disable Sign
  Ups **OFF**. Each storefront uses its **own** callback/logout/web origin.

---

## 2. Code / deployment references (read-only, verified this session)

- **Branch:** `main` @ commit `b615c89` — the merge commit of PR #61
  (cross-brand guard); also contains PR #60 429-retry `lib/management-retry.ts`
  and PR #59 DeWalt UK per-email drawer. This runbook lives on the working
  branch `v0/ciam-auth0-temp-migration-runbook`, based directly on `b615c89`.
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
    name vars** on the EU projects. The UK per-brand/per-email connection names
    must match the three `AUTH0_{DEWALT,STANLEY,PER_EMAIL}_CONNECTION` vars.
  - `AUTH0_MGMT_CLIENT_ID/SECRET` point at each tenant's **M2M app**; Model 2/3/4
    (getUserByEmail / linkIdentity / create / reset) use the Management API from
    the app, so **each** target tenant needs its own M2M app (both `setup-*.mjs`
    provision one).
- **Claims action:** `auth0/actions/add-sbd-claims.js` — Post-Login, keyed by
  storefront **client ID**, reads `SBD_API_AUDIENCE` from action secrets. New
  apps mint new client IDs, so the action's client-ID map **and** its secret must
  be set on **each** target tenant. `--emit-action` writes a per-tenant copy with
  the map already populated (EU copy has the 3 EU apps; UK copy has the 2 UK
  apps).
- **Five storefront Vercel projects (confirmed to exist):**
  `sbd-demo-dewalt-fr`, `sbd-demo-dewalt-de`, `sbd-demo-stanley-fr` (EMEA),
  `sbd-demo-dewalt-uk`, `sbd-demo-stanley-uk` (UK).
- **`AUTH0_DOMAIN*` env vars on those projects are stored as Vercel *sensitive*
  vars** — the API returns them enveloped and they cannot be read back. This is
  why domains were taken from the dashboards. Re-pointing a storefront means
  **setting** these vars, never reading them.

---

## 3. Scripts

| File | Purpose | Default |
|---|---|---|
| `mgmt.mjs` | Shared Management API helper (token from `AUTH0_MGMT_TOKEN`, 429/5xx retry, pagination, domain resolution). `resolveDomain` maps `uk`→`sbd-uk-temp1.uk.auth0.com`, `europe`/`emea`→`sbd-emea-temp1.eu.auth0.com`. `assertMutableTarget` refuses the old/rejected/stray tenants. Not executable on its own. | — |
| `inventory-users.mjs` | **Read-only** user census per tenant; flags non-test records as `REVIEW`. May target the old UK tenant as a reference (does not mutate). | read-only |
| `clear-tenant-users.mjs` | Deletes **user/database records only**; never apps/connections/actions/secrets. Refuses old/rejected tenants. `--apply` **fails closed** if any REVIEW record is not named in `--allow-review` / `--allow-review-file`. Not needed for this pass (targets start empty) — safety tool only. | **dry run** |
| `setup-emea.mjs` | On `sbd-emea-temp1` (EU-2): shared DB connection + 3 EU web apps (password-realm + passwordless/otp grants) + M2M app + Management API grant; `--emit-action` writes `out/add-sbd-claims.emea.js` with `DEMO_SITES_BY_CLIENT_ID` populated. | **dry run** |
| `setup-uk.mjs` | On `sbd-uk-temp1` (UK-1): the 3 custom DB connections (Disable Sign Ups ON, brute-force ON, Requires Username OFF) + default DB connection + passwordless email (OTP 180s/len 6) + 2 UK web apps (implicit + auth_code + refresh + password-realm + passwordless/otp) + M2M app + Management API grant; `--emit-action` writes `out/add-sbd-claims.uk.js`. | **dry run** |

Token per tenant: Dashboard → Applications → APIs → Auth0 Management API → API
Explorer. Scopes: inventory `read:users`; clear `read:users delete:users`;
setup `read/create:connections update:connections read/create/update:clients
read/create:client_grants`. Tokens are short-lived; never commit or pass them on
the command line. **Owner split:** EMEA (`+tmp4`) and UK (`+tmp5`) are different
logins — a token minted for one tenant 401s against the other.

**Local CA (operator environment):** Node's `fetch` in the operator's shell
needs the local CA bundle or TLS validation fails against the Management API.
Export it alongside the token, e.g.:

```bash
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
export AUTH0_MGMT_TOKEN=<token>
node inventory-users.mjs --tenant uk
```

The scripts use only global `fetch`, so this environment variable is all that is
required; no code change is needed.

---

## 4. Proposed sequence

Both targets are verified and empty, so provisioning can proceed now; there is
no region sign-off blocker and no required user cleanup.

**Phase A — Inventory (read-only, safe)**
1. `AUTH0_MGMT_TOKEN=<emea> node inventory-users.mjs --tenant emea` → expect 0.
2. `AUTH0_MGMT_TOKEN=<uk> node inventory-users.mjs --tenant uk` → expect 0.
3. (Optional reference) inventory the old UK tenant read-only:
   `AUTH0_MGMT_TOKEN=<old-uk> node inventory-users.mjs --domain sbd-uk-temp.uk.auth0.com`.

**Phase B — Europe provisioning (`sbd-emea-temp1`, EU-2)**
4. `AUTH0_MGMT_TOKEN=<europe> node setup-emea.mjs` → inspect the dry-run plan.
5. `... node setup-emea.mjs --apply --emit-action` → shared connection + 3 web
   apps + M2M app + Management API grant; emits `out/add-sbd-claims.emea.js`.
6. Deploy the Post-Login action on Europe from the emitted file; set its
   `SBD_API_AUDIENCE` secret. Enable `google-oauth2` on the 3 apps for Model 2.
7. Set the **base** Vercel env vars on `sbd-demo-dewalt-fr`, `-de`,
   `sbd-demo-stanley-fr`: `AUTH0_DOMAIN` (= `sbd-emea-temp1.eu.auth0.com`),
   `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` (per app), `AUTH0_MGMT_CLIENT_ID`,
   `AUTH0_MGMT_CLIENT_SECRET` (new M2M), and the shared-connection name/id vars
   (`AUTH0_CONNECTION`, `AUTH0_SHARED_CONNECTION`, `AUTH0_SHARED_CONNECTION_ID`,
   `NEXT_PUBLIC_AUTH0_CONNECTION` = the connection `setup-emea.mjs` created).
   Keep `AUTH0_SECRET`. Redeploy.

**Phase C — UK provisioning (`sbd-uk-temp1`, UK-1)**
8. `AUTH0_MGMT_TOKEN=<uk> node setup-uk.mjs` → inspect the dry-run plan.
9. `... node setup-uk.mjs --apply --emit-action` → 3 custom DB connections +
   default DB + passwordless email + 2 web apps + M2M app + Management API grant;
   emits `out/add-sbd-claims.uk.js`.
10. Deploy the Post-Login action on UK from the emitted file; set its
    `SBD_API_AUDIENCE` secret. Enable `google-oauth2` on the 2 apps for Model 2.
11. Set the **base** + UK-extra Vercel env vars on `sbd-demo-dewalt-uk`,
    `sbd-demo-stanley-uk`: `AUTH0_DOMAIN` (= `sbd-uk-temp1.uk.auth0.com`),
    `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` (per app), `AUTH0_MGMT_CLIENT_ID`,
    `AUTH0_MGMT_CLIENT_SECRET` (new M2M), the three connection name/id pairs
    `AUTH0_{DEWALT,STANLEY,PER_EMAIL}_CONNECTION(_ID)`,
    `AUTH0_PASSWORDLESS_EMAIL_CONNECTION`, plus the shared-connection vars used
    for `Username-Password-Authentication`. Keep `AUTH0_SECRET`. Redeploy.

**Phase D — Cleanup (not required this pass)**
12. Both targets start empty, so no deletion is needed. If a test pass dirties a
    target later: `AUTH0_MGMT_TOKEN=<t> node clear-tenant-users.mjs --tenant uk|europe`
    (dry run), then `--apply` once clean. Apps/connections/actions/secrets are
    untouched; REVIEW rows block `--apply` unless explicitly allow-listed.

**Phase E — Acceptance (supervisor, in-browser, against the live sites)**
13. Re-run the Model 1–4 behaviors below on the actual storefronts.

---

## 5. Ticket → acceptance mapping (what "still works live" means)

- **CIAM-12** Model 3 (UK per-email): a second email on the same account gets an
  **independent** password and reset; both emails sign into the **same** profile;
  crossed passwords fail. No duplicate profile.
- **CIAM-13** signup sends verification, account stays limited until link/code,
  resend supported (verification gate).
- **CIAM-4** documents the per-email vs per-brand credential boundaries (custom
  linked DB identities in `app_metadata.credential_bindings`).
- **CIAM-15** TEMP-tenant naming/region: targets are now `sbd-emea-temp1` (EU-2)
  and `sbd-uk-temp1` (UK-1); the abandoned US-5 `sbd-emea-temp` is recorded as a
  rejected earlier attempt.
- **CIAM-11** linked Gmail signs into the existing account, no second profile.
- **CIAM-10** duplicate social-first behavior; linking/merge + orphan handling
  documented.
- **CIAM-7** cross-site session behavior — research/root-cause/limitations only;
  auto-login is **not** a POC requirement.
- **CIAM-5** Confluence four-model doc updated post-migration (topology text is
  stale: it says one EU tenant; reality is separate EMEA + UK tenants).
- **CIAM-14** region/compliance map reflects the Okta recommendation: FR/DE →
  EMEA in Europe (`eu-west-1` Ireland) and UK → UK (`eu-west-2` London). Both new
  targets (EU-2 / UK-1) now **satisfy** this map.

Security invariants to preserve across all models: fail-closed ambiguous
lookup, local sessions, verification gate, duplicate-signup prevention, correct
recovery routing, and Stanley-vs-DeWalt password isolation (crossed brand
password must not sign in).

---

## 6. Risks

- **Claims action coupling:** the action is keyed by client ID + needs
  `SBD_API_AUDIENCE`. New client IDs without the updated map/secret ⇒ storefront
  claims silently missing ⇒ brand/market resolution breaks. Emit + deploy the
  per-tenant action and set the secret on **both** targets.
- **Controlled signup:** the three UK custom DB connections are created with
  `disable_signup:true`. If a future edit flips this on, public database signup
  would bypass the Management-API-mediated Model 3/4 flows. Keep it off.
- **Linked-identity deletion:** deleting a Model 2 primary also removes its
  secondary identities (intended). A `REVIEW`-flagged primary would take its
  links with it — hence the mandatory REVIEW pass before any `--apply` on the
  clear tool.
- **Wrong-tenant action:** the old `sbd-uk-temp`, US-5 `sbd-emea-temp`, and stray
  `sbd-eu-temp` are lookalikes of the new targets. `assertMutableTarget` refuses
  all three, and the new targets are the resolver defaults, so no mutating script
  can silently hit the wrong tenant. Inventory may still read the old UK tenant
  as a reference.
- **Sensitive Vercel vars:** domains/secrets can only be *set*, not read back;
  keep the source of truth in the dashboards, not in code.
- **Owner split:** EMEA (`+tmp4`) and UK (`+tmp5`) are different logins; a token
  minted for one tenant will 401 against the other.
