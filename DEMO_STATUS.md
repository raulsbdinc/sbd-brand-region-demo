# Demo status

The durable record of everything this demo depends on that **does not live in this
codebase**: Auth0 tenant objects, Vercel settings, and the reasoning behind the
identity model. None of it can be recovered by reading the source, so update this
file immediately after any dashboard or API change, and whenever a decision
changes.

Secrets are deliberately absent. See "Credentials" at the bottom.

## Connection-aware credentials: env contract + Auth0 matrix (25 August)

This tranche makes the per-email (case 3) and per-brand (case 4) database
credentials **routable, visible and independently resettable** inside the SAME
three storefront deployments — DeWalt France, DeWalt Germany, Stanley France.
It does **not** create deployments or Auth0 applications, and it does **not**
implement cross-storefront case-4 linking yet. It only routes credentials that
are already seeded/linked in the tenant.

> **Auth0 is NOT configured for cases 3 and 4 yet.** The app is now driven
> entirely by the environment contract below; until these connections exist in
> the tenant and the vars are set, every email continues to resolve to the
> shared `sbd-eu` connection (cases 1 & 2), unchanged. Nothing here asserts the
> tenant work is done.

### How resolution works

A submitted email + the deployment's resolved brand (`SITE_BRAND`, derived from
the `NEXT_PUBLIC_BRAND` / `NEXT_PUBLIC_MARKET` env vars in `lib/site.ts`) resolve
to **exactly one** allow-listed connection **key** server-side
(`lib/credential-model.ts` + `lib/credential-resolver.ts`). Raw connection
**names**/**ids** never cross to the browser. The resolver returns a
**discriminated** result and fails **closed**:

- **resolved** (a unique, brand-permitted, identity-backed non-shared
  credential) → attempt **only** that realm.
- **shared-default** (no non-shared match — root users, verified login aliases,
  and unknown emails) → the ordinary shared attempt (cases 1 & 2, unchanged).
- **ambiguous** — the email matches **more than one** credential (a real shared
  login **and** a non-shared credential, or two non-shared credentials). This
  fails closed with **no realm attempt at all**: sign-in returns the generic
  401, public recovery sends **nothing** (it does **not** fall back to shared),
  and passcode-start issues **no** challenge — each keeping its existing neutral
  response shape. Ambiguity is **not** a shared fallback.

So the endpoints never become an existence/connection oracle.

- **shared** → root users and verified login aliases (cases 1 & 2), all sites.
- **per-email** → a case-3 identity, on **all three** storefronts.
- **dewalt** → a case-4 identity, **only** on the two DeWalt storefronts.
- **stanley** → a case-4 identity, **only** on the Stanley storefront.

A non-shared binding only routes when it is allow-listed, its connection is
configured, it is permitted on `SITE_BRAND`, **and** it is backed by a real
linked Auth0 identity on that connection.

### Environment contract

Per deployment (existing, unchanged): `NEXT_PUBLIC_BRAND` and
`NEXT_PUBLIC_MARKET` (which `lib/site.ts` resolves into `SITE_BRAND` /
`SITE_MARKET`), `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, and the
Management grant. There is **no** `SITE_BRAND` env var — it is a derived
constant.

Connection **names** (the password-realm `realm`), server-side:

| Key | Env var(s), in precedence order | Fallback |
| --- | --- | --- |
| shared | `AUTH0_SHARED_CONNECTION` → `AUTH0_CONNECTION` → `NEXT_PUBLIC_AUTH0_CONNECTION` | `sbd-eu` |
| per-email | `AUTH0_PER_EMAIL_CONNECTION` | none |
| dewalt | `AUTH0_DEWALT_CONNECTION` | none |
| stanley | `AUTH0_STANLEY_CONNECTION` | none |

Connection **ids** (Management-API password-change / link calls), server-side,
**no fallback**: `AUTH0_SHARED_CONNECTION_ID`, `AUTH0_PER_EMAIL_CONNECTION_ID`,
`AUTH0_DEWALT_CONNECTION_ID`, `AUTH0_STANLEY_CONNECTION_ID`.

`NEXT_PUBLIC_AUTH0_CONNECTION` is retained **only** for backward compatibility
with the shared connection; no new `NEXT_PUBLIC_*` connection var is introduced,
because connection identifiers must not reach the browser.

### Auth0 application / connection matrix (to be configured)

| Storefront (`NEXT_PUBLIC_BRAND`) | Application | Connections it must enable |
| --- | --- | --- |
| DeWalt France (`dewalt`) | DeWalt FR app | `shared`, `per-email`, `dewalt` |
| DeWalt Germany (`dewalt`) | DeWalt DE app | `shared`, `per-email`, `dewalt` |
| Stanley France (`stanley`) | Stanley FR app | `shared`, `per-email`, `stanley` |

Each per-email/per-brand credential is recorded as a **non-secret**
`credential_bindings` entry in the primary account's `app_metadata`
(`{ id, email, connectionKey, auth0UserId, useCase, brand? }`) — never passwords
or tokens. Seeding those bindings + linking the identities is the remaining
tenant-side work; the app already reads, routes, surfaces and resets them.

## Customer profile: identity, MFA and account model (5 August)

The four-part customer-profile work is complete. The durable, off-codebase facts
behind it:

**Alternate email is a real identity, not a stored string.** Adding an alternate
address mails a passcode and, once the mailbox is proven, links the resulting
identity to the primary user with
`POST /api/v2/users/{id}/identities { provider: "email", user_id }`. It uses the
`{ provider, user_id }` form and **deliberately not** `{ link_with: <id_token> }`:
`link_with` is rejected with *"JWT (link_with) contains an invalid aud claim"*
whenever the Management token comes from a different application than the one that
issued the id_token, which is exactly our situation. The `{ provider, user_id }`
form has no such coupling and is equivalent once the mailbox is already proven.

**After linking, Auth0 merges the secondary record into the primary.** The
alternate address then **stops resolving as its own user** in users-by-email, and
the `sub` returned when someone signs in with that alternate becomes the
**primary** `auth0|…` sub. This is what makes "sign in with the alternate, come
back as the same person" work — and it is the basis of the sign-in guard below.

**The sign-in resolver uses users-by-email, not the search index.** Deciding
whether a typed address is a database user (database flow) or an alternate
(passwordless flow) is done with the Management API's **users-by-email direct
lookup**. The search index is **not** used in any sign-in path because it does
**not** return linked identities and is **eventually consistent** — either
property would silently route a just-linked alternate down the wrong flow.

**The sign-in guard that must never be removed.** The passwordless flow will
happily authenticate *any* address — Auth0 mints a brand-new empty user for one
it has never seen. So the verify route inspects the `sub` it gets back and only
creates a session when that `sub` is **not** a bare `email|…`. A bare `email|…`
means nobody has linked that address, so it is not an account on this storefront
and the request is refused with the drawer's ordinary failure message. Delete
this check and any address in the world signs in and lands on an empty account.

Verified against the live DeWalt France deployment on 5 August, in both
directions:

| Address used | Start step | Result |
| --- | --- | --- |
| Linked alternate | `{"ok":true}` | Session opened **as the primary account** |
| Never-linked address, correct passcode for its own mailbox | `{"ok":true}` | Refused, no session |

The two start responses are byte-identical, so the flow cannot be used to work
out which addresses we know.

**Management grant scopes.** `create:authentication_methods` was added to the
Management grant so an authenticator can be registered from our own page (part 4).
`delete:users` remains **deliberately absent**: with no way to hard-delete a user,
account deletion is **soft by construction** and cannot be turned into a
destructive call by mistake.

**MFA policy list is empty on purpose and must stay empty.** The tenant's `otp`
factor is enabled and authenticators can be registered, but the tenant's MFA
**policy list is empty**. That is intentional: an empty policy means enrolling an
authenticator **cannot** start forcing a second factor at sign-in, so it can never
break the embedded password and passcode flows. Do **not** add an MFA policy —
doing so would make embedded sign-in demand a second factor and take the demo
down. Because of this, the profile copy says an authenticator "can be required at
sign-in according to your security policy" and never claims the person will be
challenged on every sign-in.

**Phone is staged, pending an SMS provider.** Phone numbers can be added, labelled
and set as default on the profile, stored as an account identifier, but text-
message sign-in is **not** active because no SMS provider is connected. The UI
presents phone as an identifier, not an active sign-in method.

## What the demo has to show

Three brand-region sites — DeWalt France, DeWalt Germany, Stanley France —
that look like the real Polaris storefronts, where:

- One person has **one account with one password** that works on all three.
- Signing into one site still **requires a fresh login** on the next, because a
  session boundary is a domain fact, not a directory fact. Conflating those two
  is the confusion this demo exists to settle.
- Auth0 bills **one monthly active user** for that person.
- Login can be done by **password or by a one-time passcode**, and neither ever
  leaves our own branded panel.

### Requirement change, 3 August

The original ask was *different* passwords per brand, which is why the tenant
briefly had three database connections plus an Action that linked the three
identities into one user. That was reversed: the requirement is now **same user,
same password**. The three-connection model and the linking Action are therefore
being retired in favour of a single shared connection, which gives one user
record natively and needs no linking at all.

## Auth0 tenant

`stanley-black-decker-consumer.cic-demo-platform.auth0app.com`

This is the **same tenant that hosts the existing CIAM proof of concept**, chosen
deliberately so one directory can back all three sites. Tenant-wide surfaces
(Actions, prompts, email and phone providers) are therefore shared with the older
POC, and breaking it was explicitly accepted as a cost.

### Applications

One Regular Web Application per site. Regular Web rather than SPA because the
passwordless OTP grant is not issued to a SPA, and because a confidential client
is what makes embedded password login possible (see below).

| Site | Client ID |
| --- | --- |
| SBD Demo - DeWalt France | `BGDDy2XQqKEoHkjCaHcDyddwEB3yM1Va` |
| SBD Demo - DeWalt Germany | `nucmPspqRd7fh8m77mvhx0VipdIx9zyP` |
| SBD Demo - Stanley France | `3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI` |

**The third row's client id is unchanged.** On 5 August this application was
*renamed* from "SBD Demo - Craftsman France" to "SBD Demo - Stanley France", not
recreated, so `3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI` still identifies it — the single
most surprising fact on this table, and the reason nothing that references this
client id needed to change.

Callback and logout URLs on each: its own Vercel domain plus
`https://sbd-brand-region-demo.vercel.app` for the v0 preview.

**The callback path is `/auth/callback`, not `/api/auth/callback`.** This is the
single most common cause of login failure in this codebase.

Each app carries `authorization_code`, `refresh_token`, `implicit`,
`passwordless/otp`, **and both** `password` and `password-realm`. Both password
grants are needed; enabling only one produces *"Grant type ... not allowed for
the client"*.

Each app also has `token_endpoint_auth_method: client_secret_post` and
`is_token_endpoint_ip_header_trusted: true`, so the `auth0-forwarded-for` header
is honoured on `/oauth/token`. The two must be set **together**: Auth0 rejects
the trust flag on a client that does not authenticate, with *"can only be set
true on clients that require authentication"*.

### Account centre — live Management API access

The account centre (`/account`, `components/real-account.tsx`) reads and writes
the real directory record through the Auth0 Management API, called server-side by
`lib/auth0-management.ts` using the **client-credentials grant**. The three site
applications above deliberately do **not** have Management API access, so before
this was wired every Live section failed with a 403 and the page fell back to its
Demo simulation.

Access now comes from a dedicated, least-privilege machine-to-machine app:

- **Name:** `SBD Demo - Account Management (M2M)`
- **Client ID:** `0RWne76j9zA3MInSB6SmAetnRIG4UNpy`
- **Client grant:** the Management API, limited to these **13 scopes** —
  `read:users`, `update:users`, `read:users_app_metadata`,
  `update:users_app_metadata`, `read:authentication_methods`,
  `delete:authentication_methods`, `delete:guardian_enrollments`,
  `read:guardian_enrollments`, `read:organizations`,
  `create:organization_invitations`, `create:user_tickets`,
  `read:organization_members`, `read:organization_invitations`.

**`delete:users` was withheld on purpose.** Without it the account centre can
never hard-delete the single shared demo user, whatever the deletion flow tries
to call.

**Why a separate application, not scopes on the login apps.** The three site apps
are internet-facing and already carry the `password-realm` grant. Giving them
Management API scopes would widen the blast radius of a leaked client secret for
no benefit, so the privileged credentials live in their own M2M app that never
reaches the browser.

`AUTH0_MGMT_CLIENT_ID` and `AUTH0_MGMT_CLIENT_SECRET` are set on all three Vercel
projects, for production, preview and development. `lib/auth0-management.ts`
**prefers these over `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET`**, which is why the
login applications stay unprivileged and no code change was needed to bring the
account centre live.

**A change to environment variables only takes effect on a new deployment.** All
three projects were redeployed after these variables were set; anyone who adds an
env var later must redeploy or it will silently do nothing.

Verified after the redeploy: the account centre on **DeWalt Germany shows 8 Live
sections and no failures**.

**Gotcha — do not exercise "delete my account" on stage.** That path is a
**soft** delete: it blocks the user from signing in unless
`AUTH0_ALLOW_HARD_DELETE` is set to `1`, which it is not. Blocking the single
shared demo user would still break the demo, so leave it alone during a run.

### Database connection

**`sbd-eu` — `con_MtETCCoRdTvrTgZY`**, enabled on all three applications plus the
`Demo Automation M2M` client. One connection means one user record and one
password across the three sites, with no linking required.

The name carries the story: a single EU directory serving DeWalt France, DeWalt
Germany and Stanley France, because France and Germany share a compliance zone.

Superseded and **deleted** on 3 August: `dewalt-fr` (`con_47SpxTfS2YeWCAmc`),
`dewalt-de` (`con_rGDHijRVGeKL6HYz`), `craftsman-fr` (`con_xNOjfFUBxcP9UGt4`),
one per app, together with the users inside them.

Two things to know when editing connections:

- Auth0 **auto-enables `Username-Password-Authentication`**
  (`con_PRT51uxdjs8TMeVB`) on every newly created application. A second database
  connection on an app silently breaks sign-in, because Auth0 only tries the
  first. If a site starts rejecting the right password, check this first.
- Client-to-connection bindings are edited at `PATCH /connections/{id}/clients`.
  The older `enabled_clients` property on `PATCH /connections/{id}` is rejected.

### Post-login Actions

**One Action bound.** `Recognise SBD sites across brands`
(`8cd199c3-bb9a-435e-8390-8f9f4efed0e3`) is deployed and bound to the Login flow,
and is the only Action currently bound. It is scoped by client id to the three
demo applications and returns immediately for any other client, so the older CIAM
proof of concept in this tenant is untouched.

What it writes. On every successful login it appends the current site to
`app_metadata.sbd_sites` on the user record — a map of site id to ISO timestamp,
with ids `dewalt-fr`, `dewalt-de` and `stanley-fr`. That directory entry is the
source of truth the recognition beat reads back from; nothing is inferred from
the browser.

What it emits on the ID token. Note the deliberate namespace split — the
recognition claim is under `sbd.demo`, the identity claims under `sbd.com` —
matching what `lib/claims.ts` already expected.

- `https://sbd.demo/other_sites` — the array of the *other* demo sites the
  account has signed into, most recent first, each with `id`, `label` and
  `lastSignIn`. An empty array on the account's first site. Consumed by
  `extractOtherSites` in `lib/claims.ts` and rendered by
  `components/cross-brand-recognition.tsx` on the welcome route.
- `https://sbd.com/muid` — the Auth0 `user_id`.
- `https://sbd.com/idp` — the connection name, `sbd-eu`.
- `https://sbd.com/auth_method` — a friendly label derived from the login method,
  currently `Password` for the embedded password path.

The three `sbd.com` claims exist so the existing "SBD identity context" card on
the welcome page populates instead of showing its "Action not deployed"
placeholder in front of an audience.

Superseded. `Link demo identities by verified email` merged accounts sharing a
verified email so per-brand identities resolved to one user; a single shared
connection made it redundant, and it was unbound and deleted on 3 August.

`Treasure Data Push` exists in the tenant from the older POC but is not bound to
`post-login`. Leave it alone.

### Verified on 3 August

`password-realm` against `sbd-eu` with the one demo password, run against each of
the three client IDs in turn, returned three ID tokens with three different `aud`
values and **one identical `sub`** — `auth0|6a70d2138df7fe04e81e6c61`. That is
the demo's central claim proven at the protocol level, below any UI.

`POST /otp/challenge` on `sbd-eu` returns an `auth_session`, so email passcodes
are live on the shared connection. Note the field names: **`connection`** and
**`email`**, not `realm` and `username` — the challenge endpoint and the token
endpoint disagree about this, and the error messages are unhelpful.

Then rehearsed end to end in a browser against the deployed sites. Signed into
DeWalt France through the drawer; landed on `/welcome` having never left the
domain. Visited Stanley France, which sent us to sign in rather than honouring
the existing session. Signed in there with **the same email and the same
password**, and landed on its own `/welcome`.

`/welcome` prints the decoded ID token, which makes it the demo's proof surface:
put the two screens side by side and the `aud` differs while the `sub` is
identical — `auth0|6a70d2138df7fe04e81e6c61` on both. That is the entire
argument, visible on screen, without anyone having to trust a diagram.

The boundary was also probed harder than a browser can. Handing DeWalt France's
`__session` cookie directly to the other two sites leaves both unauthenticated,
because each Vercel project holds a different `AUTH0_SECRET` and the payload will
not decrypt. So the isolation does not rest on cookie scoping alone.

Failure paths return 401 with no cookie for both a wrong password and an unknown
address, and the two are indistinguishable from the outside.

## The two login paths

Both are embedded: the user stays inside our Polaris-style drawer and never sees
an Auth0-hosted page. This was the hard requirement, and each path reaches it a
different way.

### Passcode — supported, proven working

Auth0 issues one-time codes **directly on a database connection**, so the same
connection that holds the password also issues passcodes. No separate
passwordless connection, no second identity.

The Auth0 Next.js SDK mounts this natively at
`POST /auth/passwordless/otp/challenge` and `POST /auth/passwordless/otp/token`;
the second call sets the session cookie itself. Client helpers are
`passwordless.challengeWithEmail()` and `passwordless.loginWithOtp()` from
`@auth0/nextjs-auth0/client`.

**These routes require SDK 4.25 or newer** — the feature landed in 4.25.0 and the
repo was pinned at 4.22.0, which is why the route returned 404 on the deployed
site. Now pinned to 4.26.0. The middleware mount in `proxy.ts` does serve these
POSTs, verified by invoking them; no `app/auth/[auth0]/route.ts` is needed.

Two tenant switches were required:

1. **Identifier First** at `PATCH /prompts` (`{"identifier_first": true}`).
   Without it Auth0 refuses OTP on a database connection: *"OTP based
   authentication is only supported when Identifier First is enabled on your
   tenant."* Tenant-wide, so it also changes the older POC's hosted login screen.
2. **Email OTP per connection.** Email must be an identifier **and**
   `verification_method` must be `otp`; without the latter the API rejects it
   with *"Email OTP cannot be used as authentication method when email
   verification_method is not OTP."* Working shape:

   ```json
   { "options": {
       "attributes": { "email": {
         "identifier": { "active": true },
         "profile_required": true,
         "verification_method": "otp",
         "signup": { "status": "required", "verification": { "active": false } } } },
       "authentication_methods": {
         "password": { "enabled": true },
         "email_otp": { "enabled": true } } } }
   ```

Rehearsed end to end: the challenge returned an `auth_session`, the emailed code
exchanged for tokens, and the resulting `sub` matched the same user the password
resolves to.

The challenge endpoint deliberately returns a valid-looking `auth_session` even
for an unknown email, to prevent user enumeration — so a wrong address only fails
at the verify step. The UI must account for that.

Auth0 lists this as Early Access; it is already switched on for this tenant.

### Password — built and working, leaning on a `/testing` export

Live in `app/api/signin/password/route.ts`.

How it works. The browser posts credentials to **our own** Next.js route, same
origin, so there is no CORS and no third-party cookie involved. Our server then
calls `/oauth/token` with the `password-realm` grant and the client secret,
server to server.

This is why being a confidential server-side client matters. The usual objection
to embedded login — that it needs `/co/authenticate` from the browser, hence
third-party cookies, hence a custom domain — **applies to SPAs and not to us**.

Minting the session is the part with a caveat. **There is no `setSession` in SDK
v4**; the pull request that search results keep surfacing is from v1. What does
exist is `generateSessionCookie`, exported from `@auth0/nextjs-auth0/testing`,
which encrypts a `SessionData` with the SDK's own `encrypt()` and `AUTH0_SECRET`,
producing a cookie the SDK reads back as an ordinary session. So it is the SDK's
own crypto rather than something hand-rolled — but it is a supported export put
to an unsupported use.

Three things to watch, none of which matters for a proof of concept: the
`SessionData` shape could shift between SDK versions; we fake `internal.sid`,
which is what backchannel logout keys on; and `generateSessionCookie` hardcodes a
**one hour** expiry regardless of any configured session duration, so the cookie
`maxAge` should be set to match rather than letting the two disagree.

Mechanics worth not rediscovering. The session cookie is named **`__session`**.
The SDK splits anything over **3500 bytes** into `__session.0`, `__session.1` and
so on, and reassembles them on read — so a session that crosses that line and is
written as one cookie will simply not be read back. With `openid profile email`
and no refresh token the tokens measure roughly 730 and 620 characters, which
lands the encrypted cookie near 1.5 KB, comfortably clear of the threshold.
Asking for `offline_access` would add a refresh token and narrow that margin.

Checked so they do not bite later:

- There is **no native `/authenticate` or `/password/challenge`** endpoint on
  this tenant; both 404. `password-realm` is the only server-side password
  verification available.
- Post-login Actions **do** run on the password grant.
- Brute-force protection blocks after **10 attempts per identifier and IP**, and
  suspicious-IP throttling allows 100 pre-login attempts. Send
  `auth0-forwarded-for` with the real visitor IP, or Vercel's server IP absorbs
  the whole count for every user. Verified accepted on this tenant.
- **Auth0 Organizations are incompatible with Resource Owner Password.** So
  branding the hosted login via per-organization branding and doing embedded
  password login are mutually exclusive. We chose embedded.

### Rejected alternatives

- **Universal Login redirect.** Real, but visibly leaves the site, and tenant
  branding is one look for all three brands.
- **Universal Login page templates.** Full HTML control, but requires a custom
  domain.
- **Organizations branding.** Per-org logo and colours work on New Universal
  Login without a custom domain, but rule out embedded password login.

## Account creation

The three sites share the one `sbd-eu` connection, so an email address is unique
across all of them at the directory level. An address already registered on
DeWalt France **cannot be registered again** on DeWalt Germany or on Stanley
France — one record per email, not one per brand. This is the same
single-connection fact that gives "same user, same password"; it simply shows
its other face at sign-up.

What the tenant returns. The signup endpoint answers an already-registered
address with a deliberately generic **400 `invalid_signup`, "Invalid sign up"**,
byte-identical across all three brands. It never confirms that the address
exists. This is built-in Auth0 behaviour: the tenant flags were checked and there
is no toggle that makes the response more specific, so the genericness is not
something to "fix". A password that fails the connection's strength policy
returns a distinct **400 `invalid_password`, `PasswordStrengthError`**, carrying a
readable policy string. That policy is **at least 8 characters and at least 3 of
the 4 character types** — lower case, upper case, numbers, special characters.

What we built (PR 13). The drawer's "Create an account" button was a **dead
control until PR 13** — it rendered but did nothing. It is now wired to a create
step in `components/sign-in-drawer.tsx`, backed by `app/api/signup/route.ts`,
which maps the tenant's responses to a small contract — `created`,
`exists_or_invalid`, `weak_password`, `error` — and never forwards the connection
name or any other tenant detail to the browser. On `created` the drawer reuses
the **existing** password sign-in route (`app/api/signin/password/route.ts`) to
mint the session rather than duplicating that logic, then does the **same full
document navigation to `/welcome`** as the sign-in paths, for the same reason
(PR 11): a hard load tears the drawer down and re-renders against the freshly set
`__session` cookie.

**The `exists_or_invalid` message is the most sensitive string in the app.** On
that status the drawer shows a deliberately hedged line — that the visitor *may*
already have an SBD account with this address — and offers a route back to
signing in. It never asserts that the address is registered, because doing so
would turn the tenant's generic response into the exact pre-authentication
enumeration signal the rest of this demo goes out of its way not to leak (see the
passcode challenge, and the static drawer line). **Do not tighten this wording
into a confirmation.**

Verified live on the deployed sites, without creating any user. The existing demo
address returns `exists_or_invalid` on both Stanley France and DeWalt Germany —
the already-registered path — and a brand-new address paired with a weak password
returns `weak_password` rather than `exists_or_invalid`, confirming the strength
check is reached and the two failure classes stay distinct.

**The product point for Michael and Xavier.** One directory means a customer
**cannot hold separate DeWalt and Stanley accounts on the same email**. That is
the flip side of "same user, same password", and it is a product decision, not a
technical limit. A customer who wants a separate identity simply registers with a
different email — at which point they become a separate person, a separate record
and a separate monthly active user, and the cross-brand recognition panel will
not fire for them.

## Vercel

Three projects, all building from `main` of this repository, differing **only by
environment variables**. Separate domains are what create separate cookie jars,
which is what makes the session boundary real.

| Project | URL |
| --- | --- |
| `sbd-demo-dewalt-fr` | https://sbd-demo-dewalt-fr.vercel.app |
| `sbd-demo-dewalt-de` | https://sbd-demo-dewalt-de.vercel.app |
| `sbd-demo-stanley-fr` | https://sbd-demo-stanley-fr.vercel.app |

The `sbd-demo-` prefix avoids colliding with the SBD team's existing `dewalt-de`,
`dewalt-bg` and similar projects.

### Environment variables

| Variable | dewalt-fr | dewalt-de | stanley-fr |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_BRAND` | `dewalt` | `dewalt` | `stanley` |
| `NEXT_PUBLIC_MARKET` | `fr` | `de` | `fr` |
| `NEXT_PUBLIC_AUTH0_CONNECTION` | `sbd-eu` | `sbd-eu` | `sbd-eu` |
| `AUTH0_CONNECTION` | `sbd-eu` | `sbd-eu` | `sbd-eu` |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | per app | | |
| `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` | shared M2M app (see Account centre) | | |
| `AUTH0_DOMAIN` | tenant, above | | |
| `AUTH0_SECRET` | per project | | |

`AUTH0_CONNECTION` and its `NEXT_PUBLIC_` twin hold the same value. The public one
exists because the connection name is read in a client component; the server one
because API routes read it too. Both were per-brand until 3 August.

`APP_BASE_URL` is intentionally unset so the SDK infers the base URL from the
request host, keeping preview deployments working. Auth0's allowed callback list
is the safety net for that inference.

## How the code is wired

- `lib/site.ts` resolves this deployment's fixed identity — `SITE_BRAND`,
  `SITE_MARKET`, `SITE_CONNECTION` — from `NEXT_PUBLIC_` vars, validated with
  fallbacks. Each var is spelled out literally because Next.js only inlines
  `NEXT_PUBLIC_` vars written in full, never through a computed key.
- `lib/brands.ts` holds both brand skins. Every brand difference measured off the
  real sites — display font, letter case, tracking, heading size, button radius
  and fill, input underline colour — is a token in `Brand.vars`, which `AppShell`
  applies to the root. The drawer has no per-brand branching.
- Fonts: the brand display face is driven entirely by each brand's
  `--brand-display-*` tokens — family, `font-stretch`, letter case, tracking, and
  (as of 5 August) a new `--brand-display-weight`. DeWalt's face is **Archivo
  Expanded**, loaded as variable Archivo with the `wdth` axis at
  `font-stretch: 125%`, weight 900, uppercase. Stanley's is **Open Sans Condensed
  Bold**, variable Open Sans with the `wdth` axis at `font-stretch: 75%`, weight
  700, uppercase — the same technique as DeWalt, and unlike Craftsman the real
  typeface. Craftsman's real face is **GT America**, commercially licensed and
  unavailable, so Inter stands in at weight 800; Craftsman is not deployed. These
  were checked against the live properties, not assumed: `dewalt.com` (the Polaris
  property the drawer was measured from) and `stanleyoutillage.fr` both set their
  hero and section headings in the display face with Inter reserved for body copy,
  and both use ONE display face across the storefront **and** the sign-in panel.
  Note that `dewalt.fr` is a **different** property entirely — Oswald plus Roboto,
  no Archivo anywhere — so do not "correct" our type against it.
  - Until 5 August the display face was used in exactly one place, the sign-in
    drawer; every heading on the storefront, welcome and account routes was Inter,
    so outside the sign-in panel the three sites differed only in colour. Shipped
    that day: a `.brand-display` class in `app/globals.css` that pulls family,
    stretch, case, tracking and weight from the active brand's tokens, applied to
    five headings — the storefront hero and "Featured tools", the welcome route
    `h1`, the cross-brand recognition `h2`, and the account route `h1`. It is
    deliberately **not** applied to product names, the small uppercase eyebrow
    labels, the footer column headings, or any body copy, because those are Inter
    on the real sites too.
  - Two implementation notes, both of which cost time to find. First, the class is
    deliberately left OUT of any Tailwind layer, so it beats Tailwind's layered
    utilities without a specificity fight; the conflicting weight and tracking
    utilities were also removed at each call site rather than relying on source
    order to win. Second, the comment above the rule must not contain the
    two-character sequence that closes a CSS comment (a star followed by a slash) —
    easy to write by accident when listing token names with a wildcard, and it
    ends the comment early and silently mis-parses the rule below, so the class
    never reaches the compiled CSS.
- `components/sign-in-drawer.tsx` is the Polaris-style panel, with a password
  state and a passcode state. On a **successful** sign-in both paths — password
  and email passcode — do a full document navigation to `/welcome` rather than a
  client-side router push (PR 11). A soft push left the drawer mounted across the
  route change with its "Signing in..." spinner stuck over the welcome page until
  a manual reload; a hard load tears the drawer down and re-renders the server
  components against the freshly set `__session` cookie. The failure path is
  unchanged — a wrong password keeps the drawer open, clears the spinner, and
  shows the generic error.
- `lib/claims.ts` decodes the ID token claims the post-login Action emits:
  `extractOtherSites` reads the `sbd.demo/other_sites` array and
  `extractSbdClaims` the `sbd.com` identity trio. The former feeds the "Welcome
  back to SBD." panel in `components/cross-brand-recognition.tsx` on the welcome
  route; the latter feeds the "SBD identity context" card.

## Not yet configured

**Phone passcodes.** `phone_otp` sits alongside `email_otp` on `sbd-eu` and needs
no new connection — only an SMS provider on the tenant. That is the blocker.

`POST /branding/phone/providers` returns **409 "Notification Operation
Conflicted"** no matter what is sent. Ruled out as causes on 3 August, so do not
re-investigate these: the providers list is empty; there is no `sms`-strategy
connection; `/guardian/factors/phone/providers` and `/guardian/factors/sms/
providers` both 404; the Guardian `sms` factor is disabled; and the unbound
`Custom Phone Provider` Action that was suspected of holding the slot has been
deleted, which changed nothing.

The remaining likely explanation is that phone provider management is restricted
on this `cic-demo-platform` tenant, which would make it an Auth0 support question
rather than something to solve by API. Email passcodes carry the "different login
methods" half of the demo meanwhile.

## The storefront shells

Each site now reads as its brand and market: a country badge in the header, a
hero written in the brand's voice naming the market, euro pricing formatted for
the market's locale, and a brand footer. All of it derives from `SITE_BRAND` and
`SITE_MARKET` through `storefrontContent()` in `lib/site.ts`, so one build serves
all three and nothing hardcodes DeWalt or France.

The POC scaffolding is gone from the visible path — the evaluation nav, the token
inspector and the footer links to the comparison pages. The routes still exist
and still work; they are simply no longer linked. **`/welcome` is untouched on
purpose**, because its decoded ID token panel is what proves the demo on stage.

Every signed-out entry point — the hero button, each Add to cart, and the
`/welcome` guard — now opens the branded drawer in place rather than navigating
to `/signin`. That page is the old unbranded proof of concept, and one stray
click during the demo would have put it on screen instead of the Polaris panel.
The drawer's open state lives in `app-providers` so any component can raise it.

### Where the storefront imagery comes from (5 August)

The storefront originally shipped with generated stand-in product images. They
are gone. Every product shot and hero on the three sites is now the brand's own
photography, pulled from the **production asset CDNs that serve dewalt.fr and
stanleyoutillage.fr to real customers**, plus Stanley Black & Decker's own Bynder
library for the campaign heroes:

- `assets.dewalt.fr/EMEA/PRODUCT/IMAGES/HIRES/WHITEBG/…` — DEWALT product shots
- `assets.stanleyoutillage.fr/EMEA/PRODUCT/IMAGES/HIRES/WHITEBG/…` — STANLEY shots
- `bynder.sbdinc.com` — the three hero images

This matters for the room we are presenting to: the audience works here and
recognises its own products, so an invented tool would undercut everything else
on screen. The catalogue carries the **real model codes** (DCD794NT, DCF860NT,
DCS383H2 for DEWALT; SFMCD716B, SFMCF811B, SFMCS311B for STANLEY) and both brands
deliberately cover the same three categories, so moving between a DEWALT site and
the STANLEY site shows one storefront shape carrying a genuinely different range.

The files are **committed to `public/`, not hotlinked**. Nothing on stage then
depends on a third-party CDN answering, and no `next.config` remote patterns are
needed. Guessing SKU strings against the media library does not work — every
guess returns the same small fallback image — so the URLs were read off the
brands' own rendered category pages. If you add a product, take the URL from the
live site rather than constructing one, and check the saved file's byte size so a
fallback or an error page is never committed as a photo.

The two DEWALT markets carry **different heroes on purpose**. Real brands run
different regional campaigns, and on a projector the flag and market line are
easy to miss, so a different hero is what tells the audience the presenter has
actually moved to another site. Product tiles are white because the supplied
shots are on white; on the previous tinted tile the photo's own background showed
as a pale square.

## Presentation decisions

**Copy stays in English on all three sites**, including France and Germany. The
audience is English-speaking and legibility beats authenticity. The market is
signalled instead by a country label in the header, euro pricing, and a market
line in the footer. Localised copy is an easy later change if anyone wants it.

**The market is signalled with a small SVG flag, never an emoji one.** Windows
Chrome renders regional-indicator emoji as two letters rather than a flag, so
`🇫🇷` would show up as "FR" on the demo machine. Flags come from the MIT-licensed
`country-flag-icons` package and are mapped for every country in `COUNTRIES`, not
just the two we ship, so a future DeWalt UK or DeWalt US site gets one
automatically instead of silently losing it. The flag sits inside the existing
country pill in the header and the footer, and is `aria-hidden` because the
country name is already beside it as text.

**The cross-brand line in the drawer is static.** Every visitor sees that their
SBD account spans brands; it is never a lookup against the typed email. Checking
whether an address exists *before* authentication is precisely the user
enumeration hole that Auth0's own passcode challenge endpoint goes out of its way
to avoid, and reintroducing it in a demo shown to people evaluating a CIAM
platform would be an odd thing to be caught doing.

**The stronger version of that beat is now built, and it is deliberately
post-login.** The `Recognise SBD sites across brands` Action records each site in
`app_metadata.sbd_sites` (see Post-login Actions), and the welcome route renders
a "Welcome back to SBD." panel naming the sites the same account has already used.
It runs *after* authentication, so the fact comes from the directory itself and
the panel proves the shared account rather than asserting it. Answering "do you
already have an SBD account?" from a typed email *before* authentication would be
user enumeration — indefensible in a demo of a CIAM platform — which is the whole
reason the beat is post-login and not pre-login. The static drawer line above is
unaffected: it is still shown to everyone, with no lookup.

Verified live on the deployed URLs after both merges. Signing in on DeWalt France
shows no panel; signing in next on Stanley France lands on the welcome route
showing "Welcome back to SBD." naming DeWalt France with a locale-formatted last
sign-in; and DeWalt Germany then names both, most recent first. The directory id
is identical on all three.

### Rehearsal hazards

Two things will otherwise surprise someone on the day, so clear both before
presenting:

- **The panel only appears once an account has signed into a *second* site.**
  Rehearsing leaves history behind in `app_metadata.sbd_sites`, so the *first*
  site of a live run would wrongly show the panel. Reset `app_metadata.sbd_sites`
  back to an empty object on the demo user via the Management API before
  presenting.
- **Browser sessions from an earlier day can survive and predate the Action**, so
  the welcome page shows the "Action not deployed" placeholder and no recognition.
  Sign out of all three sites before rehearsing or presenting.

## 5 August — Craftsman France became Stanley France

The third site changed brand. Craftsman France is gone from the deployed set and
Stanley France takes its place; Craftsman stays in the codebase as a second brand
skin, simply no longer deployed. Everything below already happened and is live
and verified.

**Why the header is yellow.** Every Stanley brand token was measured off the live
Stanley France site, `stanleyoutillage.fr`. Stanley's brand yellow is `#FFD20A`
and its ink is `#171717`. The part that looks like a mistake and is not: Stanley
**inverts** DeWalt's lockup. DeWalt is a black bar carrying a yellow wordmark;
Stanley is a yellow bar carrying a black wordmark. So `stanley`'s `--brand-ink` is
yellow rather than the near-black the other two brands use. This is deliberate and
it earns its keep on stage — with two of the three sites now being yellow brands,
the inverted bar is what makes "you are on a different brand now" read instantly
from the back of a room. And now that the display face carries across the whole
storefront (shipped the same day — see the Fonts note above), it does even more
separating work than the header inversion: DeWalt's headings are wide and
expanded, Stanley's are narrow and condensed, so the two are unmistakable side by
side even though both are yellow.

**Two new tokens.** `--brand-wordmark-bg` and `--brand-wordmark-fg` were added
because the wordmark chip used to derive its colour from `--brand`, which breaks
when a brand's bar and its accent are the same colour — exactly Stanley's case,
where a yellow chip on a yellow bar made the wordmark vanish. The chip now reads
these dedicated tokens instead. DeWalt and Craftsman were given the values they
already resolved to (`#FEBD17`/`#1a1a1a` and `#D6001C`/`#ffffff`), so neither
changed appearance; only Stanley, at `transparent`/`#171717`, renders its real
black-on-yellow mark.

**Auth0.** The application was renamed to `SBD Demo - Stanley France` with the
**same client id** `3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI`, and its callback, logout,
allowed-origin and web-origin URLs were repointed to the new domain. Nothing about
grants, the `sbd-eu` connection, or the M2M app changed.

**The recognition Action.** `Recognise SBD sites across brands` was edited and
redeployed as **version 3**, with `stanley-fr` and "Stanley France" replacing the
Craftsman entry against that same unchanged client id. A defensive property paid
off here: the Action filters recorded sites through its own site table, so the
stale `craftsman-fr` entries already sitting in user records are ignored rather
than rendered — no user records needed cleaning up.

**The demo user.** `app_metadata.sbd_sites` was cleared to `{}` on the shared demo
user so rehearsals start from a clean recognition state.

**Vercel.** The project was renamed to `sbd-demo-stanley-fr`, the new
`.vercel.app` domain was added, and the old `sbd-demo-craftsman-fr.vercel.app`
domain was **removed** rather than left redirecting — deliberately, so nobody can
demo on a URL that names a brand we no longer show. `NEXT_PUBLIC_BRAND` is now
`stanley`. `APP_BASE_URL` is unset by design, so the base URL follows the request
host and needed no change.

**Verified live after the merge.** Stanley France renders the inverted yellow bar
with its own nav and copy; sign-in works on the new domain against the same one
account and password; and signing in afterwards on DeWalt France shows "Welcome
back to SBD." naming Stanley France with a locale-formatted timestamp.

## 6–7 August — every way in, Google, and two bugs caught in review

### "How you sign in" is the full inventory, not just what we built

The profile's sign-in section (#31) lists **eight** ways into an account rather
than the two the demo started with, because the question executives actually ask
is "what can this platform do", and a list of two invites the answer "not much".
Six are real and operable from the page: email and password, an emailed passcode,
alternate email addresses, an authenticator app, an emailed security code as a
second factor, and backup codes. Two are **explainers that deliberately do
nothing**: passkeys and text-message passcodes. They are drawn in the same
inventory rather than hidden, so the story is "here is the shape of it, here is
what stands between us and switching it on" instead of a silent gap.

Nothing in that section names Auth0 or Okta. A customer would not see a vendor
name on their own account page, and the room contains people still choosing the
vendor.

### Passkeys need a custom domain, so they cannot be demoed here

Enabling passkeys on the `sbd-eu` connection fails with **"Custom domain is
required"**. This is not the same restriction that embedded passwordless dodged
earlier: a passkey is bound to a Relying Party ID, which is a domain, and
`vercel.app` cannot serve as one — it is on the public suffix list, so a
credential registered there would be scoped to every Vercel deployment in
existence. Auth0 therefore requires a verified custom domain before it will let
the tenant register passkeys at all.

So passkeys are an **explainer row** with no action behind it. Turning them on is
not a code change; it needs a real domain (`account.dewalt.fr` or similar) on the
tenant, which is the same prerequisite already noted for branded Universal Login.

### Google sign-in reconciles to the account that already exists

"Continue with Google" is in the drawer and a Google row is in the profile (#32).
The interesting half is not the button, it is what happens underneath.

Google hands back a **separate directory user**. Left alone, a customer who used
a password on DeWalt France and Google on DeWalt Germany would become two records
and, by Michael's billing question, two monthly active users — the exact opposite
of the claim this demo exists to make. So the `Recognise SBD sites across brands`
Action (now **version 4**) links them: on a Google login with a **verified**
email, it searches the `sbd-eu` connection for an account holding that same email,
attaches the Google identity to it, and calls `setPrimaryUser` so the session
that reaches the site belongs to the original account. The customer keeps one
profile, one history, and one `sub`.

It is deliberately conservative. It acts only on a verified Google email, matches
only inside this demo's own connection, and does nothing at all when there is no
match, in which case Google is simply a new customer signing up. Every failure
path is swallowed: a linking problem must never stop someone getting into their
account.

Two caveats worth saying out loud if asked. The link is **automatic, with no "is
this you?" confirmation step** — defensible here because Google asserts the email
is verified, but a production design would probably interpose a confirmation. And
the **full Google round trip has not been exercised**, because no Google account
matching the demo user was available to test with; the Action's logic and its
deployment are confirmed, the live click-through is not.

### The MFA policy stays off, and that is a decision rather than an omission

Enrolling an authenticator works and happens inside the site, with no redirect
out to a hosted page. What is **not** switched on is the tenant policy that would
*require* a second factor at every login.

That is on purpose. Embedded sign-in exchanges credentials through the
password-realm grant; with a tenant-wide MFA policy in force that exchange stops
returning tokens and returns `mfa_required` with an `mfa_token` instead, which
this application has no UI to answer. Switching the policy on without first
building an embedded challenge screen would break **every** sign-in on all three
sites. Enrollment is therefore demonstrable today; enforcement is a known,
sequenced next step, not an oversight.

### Two bugs found while checking the sites before delivery

**Clicking the account menu crashed the whole page.** The browser showed "This
page couldn't load" and the console showed `Base UI error #31`. Cause: the
"Developer views" label added in #30 sat outside any menu group, and Base UI's
`GroupLabel` requires a `Group` parent — it throws otherwise, and an exception
thrown while rendering a menu takes the page down with it. The neighbouring
name-and-email label had always been wrapped in a group, which is why the menu
worked before that change. Fixed in #33 by wrapping the label with the two items
it names, which is also the correct accessible structure.

The lesson generalises: **Base UI enforces composition at runtime, not in the
type system.** A structurally invalid menu compiles, builds, and passes a
production build, then throws on the first click. Menus and dialogs must be
opened in a browser before they are called done.

**Signed-in customers were still being offered "Sign in or create account".** The
header said "Raul", and the hero still showed the signed-out call to action,
which opened the sign-in drawer. There were **two different notions of signed
in**: the client-side mock `session` in `app-providers.tsx` used by the showcase
flows, and a real Auth0 session that only `site-header.tsx` knew about, via an
`/api/me` lookup it kept to itself. `app/page.tsx` read the mock session alone, so
a genuine login fell into the signed-out branch.

Fixed in #33 by giving the whole app one answer: `AppProviders` now owns the
`/api/me` lookup and exposes `signedIn`, `displayName` and `authLoading`; the
header reads that instead of fetching for itself; and `openSignIn` is a **no-op
when someone is already signed in**, as the backstop for any entry point that
forgets to branch. While the lookup is still outstanding the hero reserves its
height rather than rendering the signed-out state and swapping — that flash was
itself part of what looked broken.

Signed in, the hero now follows the real MyDEWALT welcome band: a short "Welcome
back, <first name>" in the brand display face above a brand-labelled button —
"My DeWalt account", "My Stanley account", built from the brand name rather than
hardcoded — leading to the profile.

**Verified live on the deployed sites**, signed in with a real Auth0 session, on
both DeWalt Germany and Stanley France: the account menu opens with all four
items and no console error, the welcome band and branded button replace the
sign-in call to action, add-to-cart routes to the profile instead of opening the
drawer, and signing in on one brand still leaves the other signed out.

## 12 August standup — Google linking, one account, and no duplicates

The standup surfaced one real bug in the Google flow and a set of account-model
stories that had to become real behaviour. Everything below is merged to `main`
and verified live on the deployed storefronts (DeWalt France, DeWalt Germany,
Stanley France). The single invariant behind all of it: **one human, one
directory record, one billable MAU.**

**Connecting Google from the profile must link, not sign in.** The old profile
button reused the signed-out Google sign-in URL. That looked harmless, but when
the Google address did not already match the SBD account email, Auth0 created or
loaded a separate Google user and the browser session became that user. The
profile then appeared to "replace" the primary email with Gmail, which is the
opposite of the billing story: one human became two directory records.

Fixed in code by separating signed-out Google sign-in from signed-in Google
linking:

- `GOOGLE_SIGNIN_PATH` remains the signed-out drawer path.
- `GOOGLE_LINK_START_PATH` starts the signed-in connect flow.
- `/api/account/identities/google/start` captures the current primary `sub` in a
  short-lived, signed, httpOnly handoff cookie before leaving for Google.
- `/api/account/identities/google/complete` reads the post-Google session and
  handles three outcomes: already the same primary, standalone Google user that
  can be linked onto the primary, or a Google identity already owned by another
  account.

Every non-primary outcome restores the original primary session before returning
to `/profile?google=...`, so the person is never left editing the wrong account.
The profile row turns the result code into customer copy rather than exposing the
directory mechanics. Verified live: connecting a Gmail whose address did **not**
match the account email kept the browser on the primary `sub` and merged Google
into the one record.

**A Google identity can belong to only one person.** Mark's second question was
whether the same Gmail could be attached to Raul's SBD account and then also to a
different account. The completion route refuses that. If Google login resolves to
an account with other identities, it reports `in-use` and restores the initiating
account. A sign-in identifier cannot bridge two people "by osmosis".

**An alternate email signs you in with the account's own password.** Venky's
live test proved the passcode path, but a customer expects the plain thing too:
type any of your verified addresses plus your account password and get in. The
tenant's password grant only accepts the account's root database email, so a
secondary address failed. `getUsersByEmail` did not fix it — it only indexes the
root email, never a linked identity's address. The working resolution lives in
`/api/signin/password`: attempt the password grant with the typed address; if it
fails and the Management API is configured, run an Auth0 v3 search over
`app_metadata.login_alias_emails` (where every verified secondary and Google
address is persisted) plus the root email, confirm the typed address really is
one of that account's aliases, then retry the grant against the account's root
email. Every failure still returns one generic 401 — no message tells an attacker
whether an address exists. Verified live: `raul.saavedra+alt2@sbdinc.com` with
the account password lands as the primary.

**Any verified email can be made the primary, from the UI.** The profile's Email
addresses section lists every address the account can use, marks one **Primary**
and the rest "Signs you in too", and offers a **Make primary** control on the
others. `/api/account/emails/primary` validates that the chosen address is one of
the account's own verified emails (root, linked `email` identities, or linked
Google identities), writes `app_metadata.primary_email`, and backfills
`login_alias_emails` with every non-root address so sign-in keeps working from
all of them. The post-login Action **"Recognise SBD sites across brands"** now
also overrides the outgoing `email` claim with `app_metadata.primary_email`, so
the welcome band and the ID token show the address the customer designated —
while `sub` never changes. Verified live: clicking Make primary flips the labels,
and the decoded welcome token shows the designated address on the same `sub`.

**A connected Google email is a real account email, on both surfaces.** Linking
Google no longer just proves ownership; the Gmail address becomes a first-class
account email. After a successful link the complete route records the verified
Google address into `login_alias_emails`, so it appears in the Email addresses
list, can be made primary, and signs the customer in with the account password —
the same as any other alias. Disconnecting Google removes that address from the
alias list again. Verified live: the Gmail shows in Email addresses, disconnect
removes it, reconnect restores it, and Gmail + account password lands as primary.

**Signing out stays on the storefront.** The SDK's `/auth/logout` bounced the
customer out to the Auth0 domain, which breaks the demo illusion. Sign-out now
calls a local `/api/account/logout` route that expires every `__session*` cookie
— including the chunked `__session__0` / `__session__1` pair — and redirects
back to the same storefront's home. Verified live: the account menu's Sign out
clears the session and leaves the customer on the brand site.

**Signing up with an address you already own is refused — without enumerating.**
The tenant's `dbconnections/signup` only enforces uniqueness inside the `sbd-eu`
database connection, so signing up with a *secondary* address — a linked
alternate email, a linked Google email, or a persisted login alias, none of which
are database users — created a brand-new duplicate record. `/api/signup` now runs
a pre-signup check, using the same signal the password resolver trusts: an Auth0
v3 search over `app_metadata.login_alias_emails` plus the root email, requiring a
returned user to carry an `auth0` identity on the `sbd-eu` connection. If the
address already belongs to one of this deployment's accounts, signup returns the
**same** generic `exists_or_invalid` the tenant already returns for an existing
primary email — no new status, code or message, and the check runs on every
attempt so timing never distinguishes a known address from an unknown one. It
fails open: any lookup error falls through to the tenant, so a genuine new signup
is never blocked. The existing "sign in instead" passcode path is how the
customer proves ownership and reaches the one account. Verified live:
`raul.saavedra+alt@sbdinc.com` (a secondary address) is refused with
`exists_or_invalid` and creates no user, while a brand-new address still passes
the check and reaches password validation.

**Disconnect cleanup is intentionally best-effort.** Auth0 unlinking recreates
the removed identity as a standalone user. The route now tries to delete that
orphan, but only when it has exactly one identity and is not the signed-in user.
This will quietly skip in the current tenant because the Management grant still
does not include `delete:users`; granting that scope would make the cleanup live.
Until then, reconnecting the same standalone Google user still works because the
link flow can merge it back into the primary account.

## Working with the v0 chat

All application code is written and tested in the v0 chat; this side only
orchestrates and handles Auth0, Vercel and git. Two failure modes have already
cost time, so check for both.

**Work done in v0's sandbox terminal is not a tracked file edit.** A whole task
once reported success, built green, and pushed a commit with **zero file
changes** — the edits had been made with shell commands rather than the file
tools. Always confirm the pushed diff is non-empty and lists the files you
expect, rather than trusting the summary.

**v0 reuses one branch name.** Merging a v0 pull request with `--delete-branch`
and then letting v0 push again leaves the new commit on a branch that GitHub
subsequently removes, silently closing the pull request and orphaning the work.
The commit survives and can be grafted onto `main` through the Git Data API, but
it is easier to avoid: leave v0's branch alone after merging.

**v0's workspace does not follow `main`.** It stays on whatever commit it last
worked from, so once anything is merged outside the chat — including a merge of
v0's own pull request — its next branch is built on a stale base. This produced
a pull request that re-applied already-merged work *and* silently reverted
embedded password sign-in, because v0's copy of `site-header.tsx` predated it.
The diff looked plausible; only reading the file caught it.

So before merging anything from v0, check that the change does not resurrect
something already removed. The cheapest guard is to ask v0 to reset onto
`origin/main` first and confirm named markers exist in its tree — a file that
should be there, a prop that should be gone — and to stop rather than push if
any marker is missing.

## Credentials

Passwords and API tokens are **not** stored in this repository. The demo user's
credentials are at `~/sbd-demo-credentials.txt` on the operator's machine.

The Vercel API token minted for this setup should be revoked at
https://vercel.com/account/settings/tokens once the build-out is finished.
