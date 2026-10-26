# SBD brand-region identity demo

A demo for executives showing how one person can hold a **distinct login per brand-region site** while remaining **one user account and one billable monthly active user** inside a single Auth0 compliance zone.

This is not a storefront. It is three thin branded shells wrapped around a real Auth0 identity model.

## The three sites

| Site | Brand | Market | Auth0 connection |
| --- | --- | --- | --- |
| DeWalt France | DeWalt | FR | `dewalt-fr` |
| DeWalt Germany | DeWalt | DE | `dewalt-de` |
| Stanley France | Stanley | FR | `stanley-fr` |

France and Germany are both in the EU locality, so all three live in **one tenant and one directory**. That is what lets the same person be one account across them.

## What it demonstrates

- Signing into one site and visiting another **requires a fresh login** — a session boundary, enforced by separate domains.
- Each site accepts **its own password**, because each has its own database connection.
- All of those identities are linked onto **one primary user**, so Auth0 bills a single monthly active user.
- One-time passcode login by email and phone.

The re-login prompt is a *session* fact and the single user record is a *directory* fact. They are independent, and conflating them is the confusion this demo exists to settle.

## Architecture document

[Auth0: Selected Model 4, Brand + Region Credentials and Current POC Architecture (PDF)](docs/auth0-model-4-brand-region-architecture.pdf)

## Provenance

Seeded from `Customer-Engagement-Digital-Technology/sbd-sign-in-experience-v0` at commit `c36714d9f9c332b63ad50408e4af023d8f8d9631` (`main`, 14 July 2026), as a single initial commit with no inherited history.

Removed during seeding: the CIAM evidence documents (`AUTH0_COVERAGE.md`, `CIAM_EVALUATION.md`, `FEATURE_BACKLOG.md`), the documentation screenshots, and a committed `tsconfig.tsbuildinfo` build artifact. The original repository is untouched and continues to serve the existing CIAM proof of concept.

## Where state lives

`DEMO_STATUS.md` is the durable record of Auth0 and Vercel configuration, which lives outside this codebase and cannot be recovered by reading it. Update it immediately after any dashboard change.

## Callback path

Auth0 callbacks use `/auth/callback`, **not** `/api/auth/callback`. This is the most common cause of login failure in this codebase.
