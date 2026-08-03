# Demo status

The durable record of everything this demo depends on that **does not live in this
codebase**: Auth0 tenant objects and Vercel project settings. None of it can be
recovered by reading the source, so update this file immediately after any
dashboard or API change.

Secrets are deliberately absent. See "Credentials" at the bottom.

## Auth0 tenant

`stanley-black-decker-consumer.cic-demo-platform.auth0app.com`

This is the **same tenant that hosts the existing CIAM proof of concept**. That
was a deliberate choice: the demo needs one directory so one person can be one
user across all three sites. Tenant-wide surfaces (Actions, email provider,
phone provider) are therefore shared with the older POC.

### Applications

Each site gets its own Regular Web Application. Regular Web (not SPA) is
required because passwordless OTP needs the `http://auth0.com/oauth/grant-type/passwordless/otp`
grant, which Auth0 refuses to issue to a SPA.

| Site | Client ID |
| --- | --- |
| SBD Demo - DeWalt France | `BGDDy2XQqKEoHkjCaHcDyddwEB3yM1Va` |
| SBD Demo - DeWalt Germany | `nucmPspqRd7fh8m77mvhx0VipdIx9zyP` |
| SBD Demo - Craftsman France | `3aKESYWk19d4bd9JBb2CF9rUJz6l2tGI` |

Callback and logout URLs registered on each: its own Vercel domain plus
`https://sbd-brand-region-demo.vercel.app` for the v0 preview.

**The callback path is `/auth/callback`, not `/api/auth/callback`.** This is the
single most common cause of login failure in this codebase.

### Database connections

| Connection | ID | Enabled on |
| --- | --- | --- |
| `dewalt-fr` | `con_47SpxTfS2YeWCAmc` | DeWalt France only |
| `dewalt-de` | `con_rGDHijRVGeKL6HYz` | DeWalt Germany only |
| `craftsman-fr` | `con_xNOjfFUBxcP9UGt4` | Craftsman France only |

One connection per application is what gives each site **its own password**. It
is the whole mechanism behind the "one person, a different password per brand
site" beat of the demo.

Auth0 auto-enables `Username-Password-Authentication` (`con_PRT51uxdjs8TMeVB`)
on every newly created application. All three demo apps have been explicitly
**removed** from it. If a site ever starts accepting the wrong password, check
this first — a second database connection on an app silently breaks the model.

Client-to-connection bindings are edited at `PATCH /connections/{id}/clients`.
The older `enabled_clients` property on `PATCH /connections/{id}` is rejected.

### Post-login Action

`Link demo identities by verified email` — `861345ba-c0dc-4c79-bb33-4513834411c3`,
bound to the `post-login` trigger.

It merges any accounts sharing a **verified** email onto the oldest one, so the
three per-site identities resolve to a single user and Auth0 bills **one monthly
active user**. It is guarded by client ID, so logins from the older CIAM POC
exit before any merge. Failures are swallowed: a broken merge must never lock
anyone out mid-demo.

It needs three Action secrets: `MGMT_DOMAIN`, `MGMT_CLIENT_ID`,
`MGMT_CLIENT_SECRET`, pointing at a machine-to-machine app authorised for the
Management API.

### Demo user

One person, `raul.saavedra+brdemo@sbdinc.com`, created once in each of the three
connections with a **different password in each**.

Primary user after linking: `auth0|6a70c1e3a5f3541586760c6a`, carrying three
identities (`dewalt-fr`, `dewalt-de`, `craftsman-fr`). Verified: each site
accepts only its own password and rejects the other two, yet all three land on
that one primary user.

### Passcode login (email OTP on the database connections)

The passcode demo does **not** use a separate passwordless connection. Auth0
supports one-time codes directly on a database connection, so the same
`dewalt-fr` / `dewalt-de` / `craftsman-fr` connections that hold each site's
password also issue its passcodes. That means no second identity per person and
nothing extra for the linking Action to merge.

This matters for how the demo looks: it is an API flow, not a redirect, so the
passcode step happens **inside our own branded drawer**. The Auth0 Next.js SDK
mounts it natively at `POST /auth/passwordless/otp/challenge` and
`POST /auth/passwordless/otp/token`, and the second call sets the session
cookie, so we never hand the user to Auth0's hosted pages.

Two tenant-level switches were needed:

1. **Identifier First** turned on at `PATCH /prompts`
   (`{"identifier_first": true}`). Without it Auth0 refuses to enable OTP on a
   database connection: *"OTP based authentication is only supported when
   Identifier First is enabled on your tenant."* This is tenant-wide and also
   changes the hosted login screen used by the older CIAM POC.
2. **Email OTP** turned on per connection. The connection needs email marked as
   an identifier **and** `verification_method: "otp"`; without the latter the
   API rejects it with *"Email OTP cannot be used as authentication method when
   email verification_method is not OTP."* The working shape is:

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

Rehearsed on DeWalt France: the challenge returned an `auth_session`, the code
that arrived by email exchanged for tokens, and the resulting `sub` was
`auth0|6a70c1e3a5f3541586760c6a` — the same primary user the passwords resolve
to. Passcode and password land on one account.

Auth0 lists this as Early Access; it is already switched on for this tenant.

### Not yet configured

**Phone passcodes.** `phone_otp` sits alongside `email_otp` on the same three
connections and needs no new connection — only an SMS provider on the tenant.
That is the blocker: `POST /branding/phone/providers` returns 409 because an
unbound `Custom Phone Provider` Action left over from the earlier POC already
occupies the slot. Email passcodes carry this half of the demo meanwhile.

**Embedded password.** The SDK has no supported way to create a session from a
password exchange, so password sign-in still redirects to Auth0's hosted login.
Only the passcode path can stay inside the branded drawer.

## Vercel

Three projects, all building from `main` of this repository. They differ **only
by environment variables**. Separate domains are what create separate cookie
jars, which is what makes signing into one site leave you signed out of the
others — the session boundary is a domain fact, not an Auth0 setting.

| Project | URL |
| --- | --- |
| `sbd-demo-dewalt-fr` | https://sbd-demo-dewalt-fr.vercel.app |
| `sbd-demo-dewalt-de` | https://sbd-demo-dewalt-de.vercel.app |
| `sbd-demo-craftsman-fr` | https://sbd-demo-craftsman-fr.vercel.app |

The `sbd-demo-` prefix avoids colliding with the SBD team's existing `dewalt-de`,
`dewalt-bg` and similar projects.

### Environment variables

Set on all three, per project:

| Variable | dewalt-fr | dewalt-de | craftsman-fr |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_BRAND` | `dewalt` | `dewalt` | `craftsman` |
| `NEXT_PUBLIC_MARKET` | `fr` | `de` | `fr` |
| `NEXT_PUBLIC_AUTH0_CONNECTION` | `dewalt-fr` | `dewalt-de` | `craftsman-fr` |
| `AUTH0_CONNECTION` | `dewalt-fr` | `dewalt-de` | `craftsman-fr` |
| `AUTH0_CLIENT_ID` | per app, above | | |
| `AUTH0_CLIENT_SECRET` | per app | | |
| `AUTH0_DOMAIN` | tenant, above | | |
| `AUTH0_SECRET` | per project | | |

`AUTH0_CONNECTION` and its `NEXT_PUBLIC_` twin hold the same value. The public
one exists because the connection name is read in a client component; the server
one because API routes read it too.

`APP_BASE_URL` is intentionally unset so the Auth0 SDK infers the base URL from
the request host, which keeps preview deployments working. Auth0's allowed
callback list is the safety net for that inference.

## Credentials

Passwords and API tokens are **not** stored in this repository. The demo user's
three passwords are kept at `~/sbd-demo-credentials.txt` on the operator's
machine.

The Vercel API token minted for this setup should be revoked at
https://vercel.com/account/settings/tokens once the build-out is finished.
