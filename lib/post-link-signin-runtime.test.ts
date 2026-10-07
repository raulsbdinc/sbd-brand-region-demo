// Runtime regression tests for the immediate enrollment-to-sign-in 401.
// Root cause: right after a brand identity is linked, the eventually
// consistent user search can still return the standalone brand user that the
// link deleted (and a pre-link copy of the canonical account). That deleted
// record carries the same verified root email, so the cross-owner check saw two
// claimants and failed closed. These tests drive the ACTUAL candidate merge
// (reconcileCandidateLookups), resolver (resolveSigninFromUsers) and password
// handler core (runBrandPasswordSignin) with Auth0-shaped records and injected
// provider reads.
// Run with: node --test lib/post-link-signin-runtime.test.ts

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  aggregateCandidateLookups,
  reconcileCandidateLookups,
  type ConnectionKey,
} from "./credential-model.ts"
import {
  resolveSigninFromUsers,
  runBrandPasswordSignin,
  type SigninCredentialResolution,
  type SigninUserRecord,
} from "./brand-signin-core.ts"
import type { PasswordGrantOutcome } from "./password-grant-core.ts"

const NAMES = {
  shared: undefined,
  "per-email": "sbd-per-email",
  dewalt: "sbd-emea-dewalt",
  stanley: "sbd-emea-stanley",
} as Record<ConnectionKey, string | undefined>

const A = "fixture-primary@example.com"
const B = "fixture-secondary@example.com"
const CANON = "auth0|6ac6ab257b2e7dca58c3408f"
const DEWALT_ID = "6ac6ab257b2e7dca58c3408f"
const STANLEY_ID = "6ac6ab5c7d2d8d0f0993864f"
const STUB_ID = "6ac6ab58c415ff96d9f4ac4b"

function binding(brand: "dewalt" | "stanley", email: string, userId: string) {
  return { id: `${brand}-${userId}`, email, connectionKey: brand, auth0UserId: userId, useCase: "per-brand-password", brand }
}

/** Fresh canonical record after Stanley was linked with `stanleyEmail`. */
function canonicalAfterLink(stanleyEmail: string, stubEmail: string): SigninUserRecord {
  return {
    user_id: CANON,
    email: A,
    email_verified: true,
    identities: [
      { provider: "auth0", connection: "sbd-emea-dewalt", user_id: DEWALT_ID },
      { provider: "email", connection: "email", user_id: STUB_ID, profileData: { email: stubEmail, email_verified: true } },
      { provider: "auth0", connection: "sbd-emea-stanley", user_id: STANLEY_ID, profileData: { email: stanleyEmail, email_verified: true } },
    ],
    app_metadata: {
      credential_bindings: [binding("dewalt", A, DEWALT_ID), binding("stanley", stanleyEmail, STANLEY_ID)],
    },
  }
}

/** The search index's pre-link copy of the canonical account (no Stanley yet). */
function canonicalBeforeLink(stubEmail: string): SigninUserRecord {
  const fresh = canonicalAfterLink(A, stubEmail)
  return {
    ...fresh,
    identities: fresh.identities!.filter((i) => i.connection !== "sbd-emea-stanley"),
    app_metadata: { credential_bindings: [binding("dewalt", A, DEWALT_ID)] },
  }
}

/** The standalone Stanley user created for enrollment; the link deletes it. */
function deletedStanleyShadow(email: string): SigninUserRecord {
  return {
    user_id: `auth0|${STANLEY_ID}`,
    email,
    email_verified: true,
    identities: [{ provider: "auth0", connection: "sbd-emea-stanley", user_id: STANLEY_ID }],
  }
}

/** GET /users/{id} on the tenant right after the link. */
function consistentRead(records: SigninUserRecord[], calls: string[]) {
  return async (id: string) => {
    calls.push(id)
    return records.find((r) => r.user_id === id) ?? null
  }
}

function idToken(sub: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${enc({ alg: "none" })}.${enc({ sub })}.sig`
}

function okGrant(sub: string): PasswordGrantOutcome {
  return { kind: "ok", tokens: { access_token: "at", id_token: idToken(sub), expires_in: 3600, token_type: "Bearer" } } as unknown as PasswordGrantOutcome
}

async function signinWith(
  lookups: { byEmail: PromiseSettledResult<SigninUserRecord[]>; search: PromiseSettledResult<SigninUserRecord[]>; readById: (id: string) => Promise<SigninUserRecord | null> },
  email: string,
  grantSub: string,
) {
  const grants: { username: string; connectionKey: ConnectionKey }[] = []
  const result = await runBrandPasswordSignin(
    { email, password: "Maple!ab", lookupBudgetMs: 3000, signinBudgetMs: 6000 },
    {
      now: () => 1_000,
      resolve: async (e): Promise<SigninCredentialResolution> => {
        const { candidates, ok } = await reconcileCandidateLookups(lookups)
        if (!ok) return { kind: "unavailable" }
        return resolveSigninFromUsers({ email: e, siteBrand: "stanley", users: candidates, names: NAMES })
      },
      grant: async (args) => {
        grants.push({ username: args.username, connectionKey: args.connectionKey })
        return okGrant(grantSub)
      },
    },
  )
  return { result, grants }
}

const ok = <T>(value: T): PromiseFulfilledResult<T> => ({ status: "fulfilled", value })

// --- Primary-email enrollment (the live failure) -----------------------------

test("primary enrollment: the old merge reproduces the post-link ambiguity", () => {
  const { candidates } = aggregateCandidateLookups([
    ok([canonicalAfterLink(A, A)]),
    ok([canonicalBeforeLink(A), deletedStanleyShadow(A)]),
  ])
  const r = resolveSigninFromUsers({ email: A, siteBrand: "stanley", users: candidates, names: NAMES })
  assert.equal(r.kind, "ambiguous")
})

test("primary enrollment: immediate sign-in resolves the owned Stanley credential and opens one session", async () => {
  const calls: string[] = []
  const { result, grants } = await signinWith(
    {
      byEmail: ok([canonicalAfterLink(A, A)]),
      search: ok([canonicalBeforeLink(A), deletedStanleyShadow(A)]),
      readById: consistentRead([canonicalAfterLink(A, A)], calls),
    },
    "Fixture-Primary@Example.com",
    CANON,
  )
  assert.deepEqual(calls, [`auth0|${STANLEY_ID}`], "only the index-only record is re-read")
  assert.deepEqual(grants, [{ username: A, connectionKey: "stanley" }])
  assert.equal(result.kind, "session")
  if (result.kind === "session") assert.equal(result.sub, CANON)
})

// --- Verified-secondary enrollment ------------------------------------------

test("secondary enrollment: the old merge does not resolve the Stanley credential", () => {
  const { candidates } = aggregateCandidateLookups([
    ok([]),
    ok([canonicalBeforeLink(B), deletedStanleyShadow(B)]),
  ])
  const r = resolveSigninFromUsers({ email: B, siteBrand: "stanley", users: candidates, names: NAMES })
  assert.notEqual(r.kind, "resolved")
})

test("secondary enrollment: immediate sign-in with the verified secondary uses the Stanley identity's own username", async () => {
  const fresh = canonicalAfterLink(B, B)
  const calls: string[] = []
  const { result, grants } = await signinWith(
    {
      byEmail: ok([]),
      search: ok([canonicalBeforeLink(B), deletedStanleyShadow(B)]),
      readById: consistentRead([fresh], calls),
    },
    B,
    CANON,
  )
  assert.deepEqual(calls.sort(), [CANON, `auth0|${STANLEY_ID}`].sort())
  assert.deepEqual(grants, [{ username: B, connectionKey: "stanley" }])
  assert.equal(result.kind, "session")
  if (result.kind === "session") assert.equal(result.sub, CANON)
})

test("secondary enrollment: the primary address still signs in to Stanley as the same canonical account", async () => {
  const fresh = canonicalAfterLink(B, B)
  const { result, grants } = await signinWith(
    {
      byEmail: ok([fresh]),
      search: ok([canonicalBeforeLink(B), deletedStanleyShadow(B)]),
      readById: consistentRead([fresh], []),
    },
    A,
    CANON,
  )
  assert.deepEqual(grants, [{ username: B, connectionKey: "stanley" }])
  assert.equal(result.kind, "session")
})

// --- Security guarantees preserved ------------------------------------------

test("a genuinely existing second owner of the email still fails closed with no grant", async () => {
  const other: SigninUserRecord = {
    user_id: "auth0|other-owner",
    email: A,
    email_verified: true,
    identities: [{ provider: "auth0", connection: "sbd-emea-dewalt", user_id: "other-owner" }],
    app_metadata: { credential_bindings: [binding("dewalt", A, "other-owner")] },
  }
  for (const order of [[other, deletedStanleyShadow(A)], [deletedStanleyShadow(A), other]]) {
    const { result, grants } = await signinWith(
      {
        byEmail: ok([canonicalAfterLink(A, A)]),
        search: ok(order),
        readById: consistentRead([canonicalAfterLink(A, A), other], []),
      },
      A,
      CANON,
    )
    assert.equal(grants.length, 0)
    assert.equal(result.kind, "failure")
    if (result.kind === "failure") assert.equal(result.status, 401)
  }
})

test("a failed consistent re-read is unavailable (503), never a guess, and makes no grant", async () => {
  const { result, grants } = await signinWith(
    {
      byEmail: ok([canonicalAfterLink(A, A)]),
      search: ok([deletedStanleyShadow(A)]),
      readById: async () => {
        throw new Error("Management API GET /users/x failed (500)")
      },
    },
    A,
    CANON,
  )
  assert.equal(grants.length, 0)
  assert.equal(result.kind, "failure")
  if (result.kind === "failure") assert.equal(result.status, 503)
})

test("a re-read returning a different user_id fails closed", async () => {
  const merged = await reconcileCandidateLookups<SigninUserRecord>({
    byEmail: ok([]),
    search: ok([deletedStanleyShadow(A)]),
    readById: async () => canonicalAfterLink(A, A),
  })
  assert.equal(merged.ok, false)
})

test("a failed primary lookup keeps the existing fail-closed result and issues no re-reads", async () => {
  const calls: string[] = []
  const merged = await reconcileCandidateLookups<SigninUserRecord>({
    byEmail: { status: "rejected", reason: new Error("timeout") },
    search: ok([deletedStanleyShadow(A)]),
    readById: consistentRead([], calls),
  })
  assert.equal(merged.ok, false)
  assert.deepEqual(calls, [])
})

test("a grant returning the deleted child subject opens no session", async () => {
  const { result, grants } = await signinWith(
    {
      byEmail: ok([canonicalAfterLink(A, A)]),
      search: ok([deletedStanleyShadow(A)]),
      readById: consistentRead([canonicalAfterLink(A, A)], []),
    },
    A,
    `auth0|${STANLEY_ID}`,
  )
  assert.equal(grants.length, 1)
  assert.equal(result.kind, "failure")
  if (result.kind === "failure") assert.equal(result.status, 401)
})

test("records already returned by users-by-email are never re-read", async () => {
  const calls: string[] = []
  await reconcileCandidateLookups<SigninUserRecord>({
    byEmail: ok([canonicalAfterLink(A, A)]),
    search: ok([canonicalBeforeLink(A)]),
    readById: consistentRead([], calls),
  })
  assert.deepEqual(calls, [])
})
