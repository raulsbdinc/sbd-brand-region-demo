# Demo status

The durable record of everything this demo depends on that **does not live in this
codebase**: Auth0 tenant objects, Vercel settings, and the reasoning behind the
identity model. None of it can be recovered by reading the source, so update this
file immediately after any dashboard or API change, and whenever a decision
changes.

Secrets are deliberately absent. See "Credentials" at the bottom.

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
- Fonts: DeWalt's face is **Archivo Expanded**, loaded as variable Archivo with
  the `wdth` axis at `font-stretch: 125%`. Craftsman's real face is **GT
  America**, which is commercially licensed and unavailable, so Inter stands in.
  Stanley's display face is **Open Sans Condensed Bold**, loaded as variable Open
  Sans with the `wdth` axis at `font-stretch: 75%` — the same technique as DeWalt.
  Unlike Craftsman, this is the real typeface, not a stand-in.
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
from the back of a room.

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
