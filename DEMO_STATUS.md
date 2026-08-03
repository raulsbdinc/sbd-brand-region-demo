# Demo status

The durable record of everything this demo depends on that **does not live in this
codebase**: Auth0 tenant objects, Vercel settings, and the reasoning behind the
identity model. None of it can be recovered by reading the source, so update this
file immediately after any dashboard or API change, and whenever a decision
changes.

Secrets are deliberately absent. See "Credentials" at the bottom.

## What the demo has to show

Three brand-region sites — DeWalt France, DeWalt Germany, Craftsman France —
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
| SBD Demo - Craftsman France | `3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI` |

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

### Database connection

**`sbd-eu` — `con_MtETCCoRdTvrTgZY`**, enabled on all three applications plus the
`Demo Automation M2M` client. One connection means one user record and one
password across the three sites, with no linking required.

The name carries the story: a single EU directory serving DeWalt France, DeWalt
Germany and Craftsman France, because France and Germany share a compliance zone.

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

**None bound.** `Link demo identities by verified email` merged accounts sharing
a verified email so per-brand identities resolved to one user; a single shared
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

### Password — works, but leans on a `/testing` export

Decided 3 August: build it, so the password path also stays in the drawer.

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

## Vercel

Three projects, all building from `main` of this repository, differing **only by
environment variables**. Separate domains are what create separate cookie jars,
which is what makes the session boundary real.

| Project | URL |
| --- | --- |
| `sbd-demo-dewalt-fr` | https://sbd-demo-dewalt-fr.vercel.app |
| `sbd-demo-dewalt-de` | https://sbd-demo-dewalt-de.vercel.app |
| `sbd-demo-craftsman-fr` | https://sbd-demo-craftsman-fr.vercel.app |

The `sbd-demo-` prefix avoids colliding with the SBD team's existing `dewalt-de`,
`dewalt-bg` and similar projects.

### Environment variables

| Variable | dewalt-fr | dewalt-de | craftsman-fr |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_BRAND` | `dewalt` | `dewalt` | `craftsman` |
| `NEXT_PUBLIC_MARKET` | `fr` | `de` | `fr` |
| `NEXT_PUBLIC_AUTH0_CONNECTION` | `sbd-eu` | `sbd-eu` | `sbd-eu` |
| `AUTH0_CONNECTION` | `sbd-eu` | `sbd-eu` | `sbd-eu` |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | per app | | |
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
- Fonts: DeWalt's face is **Archivo Expanded**, loaded as variable Archivo with
  the `wdth` axis at `font-stretch: 125%`. Craftsman's real face is **GT
  America**, which is commercially licensed and unavailable, so Inter stands in.
- `components/sign-in-drawer.tsx` is the Polaris-style panel, with a password
  state and a passcode state.

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

## Credentials

Passwords and API tokens are **not** stored in this repository. The demo user's
credentials are at `~/sbd-demo-credentials.txt` on the operator's machine.

The Vercel API token minted for this setup should be revoked at
https://vercel.com/account/settings/tokens once the build-out is finished.
