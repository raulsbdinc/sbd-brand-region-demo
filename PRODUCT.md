# SBD Sign-In Experience — Product Overview

> **Status legend:** 🟢 **Working in this POC** · 🟡 **Demo only** · 🔵 **Partly connected** · ⚪ **Production work**

## What this is

An interactive prototype of the customer sign-in experience for a Stanley Black &
Decker storefront. It lets us **see and click through every sign-in option in one
place** to decide which methods to offer and how they should feel — before
committing engineering time. Think clickable mockup, not a shippable feature.

## Why it exists

1. **Compare options** — show the real trade-offs (speed, steps, what the user
   needs) so we can choose with the facts in front of us.
2. **Test the experience** — give stakeholders something real to click through.
3. **Check the Auth0 / Okta direction** — show how one identity platform can
   handle many sign-in methods behind one consistent experience.

We have chosen Auth0 / Okta as the identity platform. It charges per monthly active
user, which keeps the cost low for our many small sites. The next question is how
it scales worldwide — see the **architecture** view (`/architecture`) for the
proposal: every market where SBD has a legal entity, grouped by privacy law and
location into as few tenants as the rules allow (4 plus China), one application per
site, and data hosted in the region each market needs.

## What to understand

- **The simulated methods aren't real** — no one is logged in, nothing is sent
  or stored. Safe to share and demo. **Social** and **Classic password** are now
  real Auth0 logins, and **passwordless email** (email code + magic link) is
  wired up and waiting on a tenant connection to go live.
- **It's intentionally simple** — the focus is sign-in, not a full store. The
  surrounding storefront content is placeholder ("For Position Only").
- **One brand, DeWalt** — the POC is locked to the DeWalt brand so attention
  stays on the sign-in experience and the data-residency model. The header lets
  you switch the **data-residency region** (not the brand).
- **Progress is tracked.** A plain changelog at `/changelog` (linked in the
  footer) records what changed in each iteration, working toward 1.0.0, the point
  where the agreed POC scope is complete.

## The sign-in methods

| Method | What the customer does | Best for | Status |
| --- | --- | --- | --- |
| **Passkey** | Face / fingerprint, no password | Fastest; returning users | 🟡 Demo only |
| **Magic link** | Open a one-time emailed link | No password to remember | 🔵 Partly connected |
| **Email code** | Enter a 6-digit emailed code | Works on any device | 🔵 Partly connected |
| **Classic password** | Email + password on the hosted Auth0 page | Traditional login | 🟢 Working in this POC |
| **Social provider** | Continue with Google, Apple, Microsoft, etc. | Lowest effort | 🟢 Working in this POC |
| **Employee SSO** | SBD work-account sign-in | Internal access | 🟡 Demo only |
| **QR invite** | Scan a code handed out at a counter | In-person onboarding | 🟡 Demo only |
| **Try it live** (`/live`) | A real Auth0 redirect login | Proving the platform works | 🟢 Working in this POC |

A **comparison view** (`/journeys`) lays these out side by side with approximate
steps and time-to-signed-in. An **account center** (`/account`) shows what an
Okta-powered account looks like: after a real login it displays a profile from
genuine Auth0 claims plus management for email, password, MFA, passkeys,
multi-tenant organizations, and privacy self-service. Data export reads the
Auth0 profile. The deletion flow blocks or deletes the identity and can send a
best-effort downstream webhook; it does not verify downstream erasure. Account
management uses the Auth0 Management API only when this deployment has a real
session, credentials, scopes, and provider support. Otherwise the sections show
a labeled demo.
Setup is documented in the [feature backlog](/docs?doc=features), Part 3.

## What this prototype can and can't tell us

**Can:** which methods feel good, which take too many steps, what the screens and
copy should say, and whether the Auth0/Okta approach works as one experience.

**Can't:** real success rates, production security, email deliverability, or
performance at scale — those need the real build.

## Implementation progress

This is the plain-language view. For the detailed engineering status (file
paths, scopes, env vars), see the **Feature backlog & status** tab — it's the
single source of truth and this table is a stakeholder-friendly summary of it.

| Capability | Status | What it means for the customer |
| --- | --- | --- |
| Clickable showcase of all 7 sign-in methods | 🟢 Working in this POC | Every method has a usable journey, but several are explicitly demo-only |
| Side-by-side method comparison | 🟢 Working in this POC | Compare the steps and effort of each method |
| In-app documentation | 🟢 Working in this POC | These docs, always in sync with the build |
| Region & tenant architecture view | 🟢 Working in this POC | The proposed map — every SBD market grouped by privacy law and location into 4 regional tenants plus China |
| CIAM evaluation view | 🟢 Working in this POC | A filterable page at `/evaluation` separating POC evidence (built, validated, simulated, production work, or not exercised) from documented delivery through Auth0, integrations, partners, or SBD |
| CIAM operations dashboard | 🟡 Demo only | `/operations` is a working current-tenant command center for authentication health, registration conversion, verification, MFA, markets, and threat signals. Its public figures are clearly labeled synthetic aggregates; live Auth0 ingestion and operator authorization are still production work |
| Region-aware sign-in | 🔵 Partly connected | Picking a data-residency region routes the visitor to the right regional tenant; to them the regions look like separate, local sign-in experiences |
| Real identity platform connected | 🟢 Working in this POC | A real customer can sign into this app against the SBD identity tenant |
| Multiple registration journeys | 🟢 Working in this POC | Newsletter and product registration preserve their own context, require versioned legal acceptance, and converge on one secure account journey |
| Pro team invitations | 🟢 Working in this POC | Supplier and dealer teammates can be invited through an organization-scoped onboarding path; the server verifies the inviter belongs to the selected team |
| Real social login | 🟢 Working in this POC | Branded picker into Google/Apple/etc., then back to a signed-in welcome |
| Real password login | 🟢 Working in this POC | Branded intro into the real hosted sign-in page, then welcome |
| Real profile after sign-in | 🟢 Working in this POC | The account center shows the customer's genuine profile |
| Progressive profiling | 🟢 Working in this POC | After sign-in, SBD asks only for missing name and phone details; customers can save them or continue without answering |
| Account recovery | 🟢 Working in this POC | Customers can reset a password or recover their email-based account identifier without the screen revealing whether an account exists |
| Email verification | 🟢 Working in this POC | The account center shows verified or pending status and can resend a verification email to the signed-in customer |
| Edit personal details | 🟢 Working in this POC | Name, photo, phone, and email changes save to the real directory |
| Site preferences | 🟢 Working in this POC | Region, language, and communication choices the customer controls (brand is fixed to DeWalt in this POC) |
| Account management | 🟢 Working in this POC | Email, password, two-factor, passkeys, organizations, and privacy (data export & deletion) all run live; some security enrollment hands off to the hosted flow |
| Right to be forgotten | 🟢 Working in this POC | The POC provides an identity-deletion path, a receipt, a regional orchestration model, and a demo restore tool. Downstream orders, warranties, marketing, and support erasure adapters are simulated; production delivery requires those system integrations and governance. |
| Graceful sign-in problems | 🟢 Working in this POC | If a sign-in can't complete — for example the account was deactivated — the customer lands on a clear, reassuring page that explains what happened and what to do next, instead of a raw error |
| Consent & permissions | 🟢 Working in this POC | The customer can grant or withdraw consent and view a POC audit timeline. Production-grade immutability, retention, evidence, and downstream enforcement still require governed storage and integrations. |
| Cross-region account management (SBD Passport) | 🔵 Partly connected | `/passport` can store or demo regional link records. It does not sign the person into another region, prove ownership of that account, or hand off a regional session. |
| Passwordless email (magic link + code) | 🔵 Partly connected | The app flow exists, but it remains a demo until the Auth0 email connection and deployment setting are enabled and tested. |
| Real passkey / work-account logins | ⚪ Production work | Promote once those connections are enabled |
| Production hardening (security, scale, deliverability) | ⚪ Production work | Requires the real build |

**POC conclusion:** this repository provides decision-support evidence, not a
production approval. The [Auth0 coverage guide](/docs?doc=coverage) summarizes
vendor documentation and proposed delivery paths. Remaining work includes plan
selection, tenant and provider setup, SBD integrations, legal and security review,
accessibility testing, operational design, and end-to-end production testing. Passkey and MFA
screens remain explainers; Auth0 owns credential enrollment and authentication.

_For the detailed engineering status and the full platform scope, see the
**Feature backlog & status** tab._
