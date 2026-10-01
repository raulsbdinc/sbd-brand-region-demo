import { test } from "node:test"
import assert from "node:assert/strict"
import {
  evaluateAddEmailOwnership,
  enumerateOwnershipCandidates,
  hydrateOwnershipCandidates,
  planAddEmailOwnership,
  collectIdentityOwnedEmails,
  addEmailRejectionCopy,
  mapAddEmailGuardResponse,
  type AddEmailCandidate,
} from "./add-email-ownership.ts"

// ============================================================================
// evaluateAddEmailOwnership — the canonical-id comparison core.
// ============================================================================

test("rejects when a DIFFERENT canonical customer owns the email", () => {
  const decision = evaluateAddEmailOwnership({
    email: "josem18519@mapsguy.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "auth0|C" }],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("allows when the email is unowned", () => {
  const decision = evaluateAddEmailOwnership({
    email: "brand-new@example.com",
    currentUserId: "auth0|A",
    owners: [],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("allows when the ONLY owner is the current canonical user (Model 4 / retry)", () => {
  const decision = evaluateAddEmailOwnership({
    email: "mine@example.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "auth0|A" }],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("rejects when the current user AND a foreign user both own it", () => {
  const decision = evaluateAddEmailOwnership({
    email: "shared@example.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "auth0|A" }, { canonicalUserId: "auth0|C" }],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("fails closed as unavailable when the directory lookup failed", () => {
  const decision = evaluateAddEmailOwnership({
    email: "x@example.com",
    currentUserId: "auth0|A",
    owners: [],
    lookupOk: false,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "unavailable")
})

test("fails closed as ambiguous when an owner has no canonical id", () => {
  const decision = evaluateAddEmailOwnership({
    email: "x@example.com",
    currentUserId: "auth0|A",
    owners: [{ canonicalUserId: "  " }],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "ambiguous")
})

// ============================================================================
// planAddEmailOwnership — candidate reduction (stub filtering + normalization).
// ============================================================================

const realAccount = (userId: string, emails: string[]): AddEmailCandidate => ({
  userId,
  ownedEmails: emails,
  hasRealIdentity: true,
})

test("different canonical owner is rejected from real candidates", () => {
  // Customer C owns josem18519@mapsguy.com with dewalt+stanley identities.
  const decision = planAddEmailOwnership({
    email: "josem18519@mapsguy.com",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|C", ["josem18519@mapsguy.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("same canonical owner is allowed (idempotent / Model 4 cross-brand)", () => {
  const decision = planAddEmailOwnership({
    email: "MINE@example.com",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|A", ["mine@example.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("email is matched case/space-insensitively (normalized)", () => {
  const decision = planAddEmailOwnership({
    email: "  Jose.M@Example.com ",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|C", ["jose.m@example.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("a transient passwordless stub for the target email is NOT an owner", () => {
  // The emailed-code step mints a bare `email` OTP stub for the typed address.
  // It must not count as a foreign owner and block a legitimate unowned add.
  const decision = planAddEmailOwnership({
    email: "brand-new@example.com",
    currentUserId: "auth0|A",
    candidates: [
      {
        userId: "auth0|stub",
        ownedEmails: ["brand-new@example.com"],
        hasRealIdentity: false,
      },
    ],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

test("an account that does not actually own the email is ignored", () => {
  const decision = planAddEmailOwnership({
    email: "target@example.com",
    currentUserId: "auth0|A",
    candidates: [realAccount("auth0|C", ["someone-else@example.com"])],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

// ============================================================================
// Rejection copy — the exact customer-facing string.
// ============================================================================

test("different-owner copy is the required customer string", () => {
  assert.equal(
    addEmailRejectionCopy("different-owner"),
    "This email is already used by another account and cannot be added here.",
  )
})

// ============================================================================
// collectIdentityOwnedEmails — every identity's email counts as owned, incl.
// an UNVERIFIED social profileData email (the linked-Google discovery gap).
// ============================================================================

test("collects a linked Google identity's profileData email even when unverified", () => {
  // Canonical A: root email dedes10491@mediseat.com, with a linked Google
  // identity carrying raul.sbdinc@gmail.com. The social profileData may omit or
  // stringify email_verified — ownership must not depend on that flag.
  const emails = collectIdentityOwnedEmails({
    email: "dedes10491@mediseat.com",
    identities: [
      { profileData: {} }, // primary DB identity, no email in profileData
      { profileData: { email: "raul.sbdinc@gmail.com" } }, // linked Google, no email_verified
    ],
  })
  assert.ok(emails.includes("dedes10491@mediseat.com"))
  assert.ok(emails.includes("raul.sbdinc@gmail.com"))
})

test("collects an identity's top-level email and normalizes casing/space", () => {
  const emails = collectIdentityOwnedEmails({
    email: "  Root@Example.com ",
    identities: [{ email: "Alt@Example.com", profileData: { email: "  Third@Example.com" } }],
  })
  assert.deepEqual(
    [...emails].sort(),
    ["alt@example.com", "root@example.com", "third@example.com"].sort(),
  )
})

test("tolerates missing/empty identities and emails", () => {
  assert.deepEqual(collectIdentityOwnedEmails({}), [])
  assert.deepEqual(collectIdentityOwnedEmails({ email: "", identities: null }), [])
  assert.deepEqual(
    collectIdentityOwnedEmails({ identities: [{ profileData: null }, {}] }),
    [],
  )
})

// ============================================================================
// FOREIGN LINKED-GOOGLE OWNERSHIP — the reported preview defect, end to end
// through the pure reduction with ownedEmails built the way the server bridge
// now builds them (identity emails included).
// ============================================================================

test("rejects adding a Gmail owned ONLY via a foreign account's linked Google identity", () => {
  // Signed in as canonical B (auth0|B). The Gmail raul.sbdinc@gmail.com is a
  // linked Google identity on a DIFFERENT canonical A (auth0|A) — its root email
  // is dedes10491@mediseat.com, so /users-by-email(Gmail) never surfaced A and
  // the add was wrongly allowed. With identity emails included in ownedEmails,
  // A is a real owner of the Gmail and the add must be rejected.
  const foreignA: AddEmailCandidate = {
    userId: "auth0|A",
    ownedEmails: collectIdentityOwnedEmails({
      email: "dedes10491@mediseat.com",
      identities: [
        { profileData: {} },
        { profileData: { email: "raul.sbdinc@gmail.com" } },
      ],
    }),
    hasRealIdentity: true,
  }
  // The transient passwordless OTP stub the code step minted for the Gmail.
  const stub: AddEmailCandidate = {
    userId: "auth0|stub",
    ownedEmails: ["raul.sbdinc@gmail.com"],
    hasRealIdentity: false,
  }

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: [foreignA, stub],
    lookupOk: true,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("Model 4 no-regression: same canonical owner via its own linked identity is allowed", () => {
  // The email lives on the CURRENT account's own linked identity — adding/linking
  // a new brand credential for it must still be allowed.
  const selfOwned: AddEmailCandidate = {
    userId: "auth0|B",
    ownedEmails: collectIdentityOwnedEmails({
      email: "wacev92852@mapsguy.com",
      identities: [{ profileData: { email: "raul.sbdinc@gmail.com" } }],
    }),
    hasRealIdentity: true,
  }
  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: [selfOwned],
    lookupOk: true,
  })
  assert.equal(decision.ok, true)
})

// ============================================================================
// enumerateOwnershipCandidates — deterministic paginated directory enumeration.
// This replaces the eventually-consistent v3 indexed search that did NOT
// surface a linked social identity's profileData.email on the live tenant.
// ============================================================================

interface FakeUser {
  user_id: string
  email?: string
  identities?: Array<{ email?: unknown; profileData?: Record<string, unknown> | null }>
  passwordless?: boolean
}

function toFakeCandidate(u: FakeUser): AddEmailCandidate {
  return {
    userId: u.user_id,
    ownedEmails: collectIdentityOwnedEmails(u),
    hasRealIdentity: !u.passwordless,
  }
}

/** Build a paginated fetcher over a fixed user list, reporting a grand total. */
function pagedFetcher(users: FakeUser[], opts?: { total?: number; throwOnPage?: number }) {
  const total = opts?.total ?? users.length
  return async (page: number, perPage: number) => {
    if (opts?.throwOnPage === page) throw new Error("directory read failed")
    const start = page * perPage
    return { users: users.slice(start, start + perPage), total }
  }
}

test("enumeration: collects owners across MULTIPLE pages and allows unowned add", async () => {
  const users: FakeUser[] = Array.from({ length: 25 }, (_, i) => ({
    user_id: `auth0|u${i}`,
    email: `user${i}@example.com`,
  }))
  const { candidates, ok } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(users),
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, true)
  assert.equal(candidates.length, 25) // all 3 pages (10 + 10 + 5) collected

  const decision = planAddEmailOwnership({
    email: "brand-new@example.com",
    currentUserId: "auth0|u0",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, true)
})

test("enumeration: LATER-PAGE foreign linked-Google owner is discovered and rejected", async () => {
  // Fill page 0, then place foreign owner A (owns the Gmail ONLY via a linked
  // Google identity's profileData.email) on page 2 — exactly the record the
  // indexed search missed on the live tenant.
  const filler: FakeUser[] = Array.from({ length: 20 }, (_, i) => ({
    user_id: `auth0|f${i}`,
    email: `f${i}@example.com`,
  }))
  const foreignA: FakeUser = {
    user_id: "auth0|A",
    email: "dedes10491@mediseat.com",
    identities: [
      { profileData: { email: "dedes10491@mediseat.com" } },
      { email: "raul.sbdinc@gmail.com", profileData: { email: "raul.sbdinc@gmail.com" } },
    ],
  }
  const users = [...filler, foreignA] // A is the 21st record → page 2 at perPage 10

  const { candidates, ok } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(users),
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, true)

  // Signed in as B, adding A's linked Gmail must be REJECTED.
  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("enumeration: a page FAILURE fails closed (unavailable), never a silent allow", async () => {
  const users: FakeUser[] = Array.from({ length: 25 }, (_, i) => ({
    user_id: `auth0|u${i}`,
    email: `user${i}@example.com`,
  }))
  const { ok, candidates } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(users, { throwOnPage: 1 }),
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, false)

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "unavailable")
})

test("enumeration: TRUNCATION (total exceeds page budget) fails closed", async () => {
  const users: FakeUser[] = Array.from({ length: 30 }, (_, i) => ({
    user_id: `auth0|u${i}`,
    email: `user${i}@example.com`,
  }))
  // Report a total far larger than what the tiny page budget can ever read.
  const { ok } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(users, { total: 5000 }),
    perPage: 10,
    maxPages: 2, // can read at most 20 of a claimed 5000
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, false)
})

test("enumeration: an unexpected EMPTY page before the total fails closed", async () => {
  const fetchPage = async (page: number) => {
    if (page === 0) return { users: [{ user_id: "auth0|u0", email: "u0@example.com" }], total: 100 }
    return { users: [] as FakeUser[], total: 100 } // cannot make progress to 100
  }
  const { ok } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage,
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, false)
})

test("enumeration: transient passwordless STUB on a later page is never counted as owner", async () => {
  const filler: FakeUser[] = Array.from({ length: 10 }, (_, i) => ({
    user_id: `auth0|f${i}`,
    email: `f${i}@example.com`,
  }))
  // The OTP stub the code step minted for the Gmail — root email is the target,
  // no real identity.
  const stub: FakeUser = {
    user_id: "auth0|stub",
    email: "brand-new@example.com",
    passwordless: true,
  }
  const users = [...filler, stub]
  const { candidates, ok } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(users),
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, true)

  // Adding this brand-new address must still be ALLOWED — the stub is not an owner.
  const decision = planAddEmailOwnership({
    email: "brand-new@example.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, true)
})

test("enumeration: same-canonical Model 4 (email on the CURRENT account) is allowed", async () => {
  const self: FakeUser = {
    user_id: "auth0|B",
    email: "wacev92852@mapsguy.com",
    identities: [{ email: "raul.sbdinc@gmail.com", profileData: { email: "raul.sbdinc@gmail.com" } }],
  }
  const others: FakeUser[] = Array.from({ length: 12 }, (_, i) => ({
    user_id: `auth0|o${i}`,
    email: `o${i}@example.com`,
  }))
  const users = [...others, self]
  const { candidates, ok } = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(users),
    perPage: 5,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
  })
  assert.equal(ok, true)

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, true)
})

// ============================================================================
// hydrateOwnershipCandidates — per-user re-fetch of every enumerated id. The
// directory LIST payload omits identities[].profileData.email on the live
// tenant, so ownership MUST be built from a full getUser(id) hydration. These
// tests model that: the LIST record carries only user_id + root email, and the
// HYDRATION read reveals the linked Google profileData.email.
// ============================================================================

/** A hydration fetcher backed by a fixed id→full-record map. */
function hydrationFetcher(
  fullById: Record<string, FakeUser>,
  opts?: { throwOnId?: string; mismatchId?: string },
) {
  return async (userId: string): Promise<FakeUser> => {
    if (opts?.throwOnId === userId) throw new Error("hydration read failed")
    const full = fullById[userId]
    if (!full) throw new Error(`no such user ${userId}`)
    // Simulate a record whose returned id does not match the requested id.
    if (opts?.mismatchId === userId) return { ...full, user_id: `${full.user_id}-different` }
    return full
  }
}

test("hydration: LIST gives only id/root, getUser reveals foreign Google email → REJECT", async () => {
  // Enumeration (list payload) surfaces A with ONLY a root email — the linked
  // Google identity is invisible in the list, exactly like the live tenant.
  const listA: FakeUser = { user_id: "auth0|A", email: "dedes10491@mediseat.com" }
  const listFiller: FakeUser[] = Array.from({ length: 4 }, (_, i) => ({
    user_id: `auth0|f${i}`,
    email: `f${i}@example.com`,
  }))
  const listUsers = [...listFiller, listA]

  // getUser(A) returns the FULL record incl. the linked Google profileData.email.
  const fullById: Record<string, FakeUser> = {
    "auth0|A": {
      user_id: "auth0|A",
      email: "dedes10491@mediseat.com",
      identities: [
        { profileData: { email: "dedes10491@mediseat.com" } },
        { email: "raul.sbdinc@gmail.com", profileData: { email: "raul.sbdinc@gmail.com" } },
      ],
    },
    ...Object.fromEntries(listFiller.map((u) => [u.user_id, u])),
  }

  // Phase 1: enumerate ids from the list (do not trust list profileData).
  const enumeration = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(listUsers),
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: (u) => ({ userId: u.user_id, ownedEmails: [], hasRealIdentity: false }),
  })
  assert.equal(enumeration.ok, true)

  // Phase 2: hydrate every id → ownership now sees A's linked Gmail.
  const { candidates, ok } = await hydrateOwnershipCandidates<FakeUser>({
    userIds: enumeration.candidates.map((c) => c.userId),
    fetchUser: hydrationFetcher(fullById),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 3,
  })
  assert.equal(ok, true)

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "different-owner")
})

test("hydration: a per-user fetch FAILURE fails closed (unavailable)", async () => {
  const fullById: Record<string, FakeUser> = {
    "auth0|A": { user_id: "auth0|A", email: "a@example.com" },
    "auth0|B": { user_id: "auth0|B", email: "b@example.com" },
  }
  const { ok, candidates } = await hydrateOwnershipCandidates<FakeUser>({
    userIds: ["auth0|A", "auth0|B"],
    fetchUser: hydrationFetcher(fullById, { throwOnId: "auth0|B" }),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 3,
  })
  assert.equal(ok, false)

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.ok === false && decision.reason, "unavailable")
})

test("hydration: a MISSING user id in the input fails closed", async () => {
  const { ok } = await hydrateOwnershipCandidates<FakeUser>({
    userIds: ["auth0|A", ""],
    fetchUser: hydrationFetcher({ "auth0|A": { user_id: "auth0|A" } }),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 3,
  })
  assert.equal(ok, false)
})

test("hydration: a MISMATCHED returned id fails closed", async () => {
  const fullById: Record<string, FakeUser> = {
    "auth0|A": { user_id: "auth0|A", email: "a@example.com" },
  }
  const { ok } = await hydrateOwnershipCandidates<FakeUser>({
    userIds: ["auth0|A"],
    fetchUser: hydrationFetcher(fullById, { mismatchId: "auth0|A" }),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 3,
  })
  assert.equal(ok, false)
})

test("hydration: same-canonical Model 4 preserved (email on the current account's linked identity)", async () => {
  // getUser(B) reveals B owns the Gmail via its OWN linked Google identity.
  const fullById: Record<string, FakeUser> = {
    "auth0|B": {
      user_id: "auth0|B",
      email: "wacev92852@mapsguy.com",
      identities: [
        { email: "raul.sbdinc@gmail.com", profileData: { email: "raul.sbdinc@gmail.com" } },
      ],
    },
    "auth0|o0": { user_id: "auth0|o0", email: "o0@example.com" },
  }
  const { candidates, ok } = await hydrateOwnershipCandidates<FakeUser>({
    userIds: ["auth0|o0", "auth0|B"],
    fetchUser: hydrationFetcher(fullById),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 3,
  })
  assert.equal(ok, true)

  const decision = planAddEmailOwnership({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates,
    lookupOk: ok,
  })
  assert.equal(decision.ok, true)
})

test("hydration: all ids hydrate successfully → ok true, every candidate present", async () => {
  const fullById: Record<string, FakeUser> = {
    "auth0|1": { user_id: "auth0|1", email: "1@example.com" },
    "auth0|2": { user_id: "auth0|2", email: "2@example.com" },
    "auth0|3": { user_id: "auth0|3", email: "3@example.com" },
  }
  const { candidates, ok } = await hydrateOwnershipCandidates<FakeUser>({
    userIds: ["auth0|1", "auth0|2", "auth0|3"],
    fetchUser: hydrationFetcher(fullById),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 2,
  })
  assert.equal(ok, true)
  assert.equal(candidates.length, 3)
})

// ============================================================================
// ROUTE CONTRACT — the exact { status, error } every email-linking route
// (POST /api/account/emails/verify AND POST /api/registration/per-email/complete)
// returns for a guard decision, via the shared pure mapper `guardAddEmailOwnership`
// funnels through. The reported defect was that /api/account/emails/verify linked
// a foreign linked-Google Gmail with 200 ok:true; these lock in that the shared
// guard maps that case to a 409 rejection with the required customer copy, and
// that the same-canonical Model 4 case maps to an allow.
// ============================================================================

/**
 * The full pipeline a route runs: enumerate+hydrate reduction → pure decision →
 * HTTP mapping. This mirrors the server `guardAddEmailOwnership` bridge minus the
 * Auth0 I/O, so the route contract can be asserted deterministically.
 */
function guardResponseFor(params: {
  email: string
  currentUserId: string
  candidates: AddEmailCandidate[]
  lookupOk: boolean
}) {
  const decision = planAddEmailOwnership(params)
  return mapAddEmailGuardResponse(decision)
}

test("route contract: /emails/verify — foreign linked-Google Gmail → 409 + required copy", async () => {
  // Reproduces the exact preview failure: signed in as canonical B, adding
  // raul.sbdinc@gmail.com which is a linked Google identity on a DIFFERENT
  // canonical A. The list payload hid A's Google email; the hydrated getUser(A)
  // reveals it. The route MUST return a 409 refusal, NOT 200 ok:true.
  const listUsers: FakeUser[] = [
    { user_id: "auth0|B", email: "wacev92852@mapsguy.com" },
    { user_id: "auth0|A", email: "dedes10491@mediseat.com" }, // Google email hidden in list
    { user_id: "auth0|stub", email: "raul.sbdinc@gmail.com", passwordless: true }, // OTP stub
  ]
  const fullById: Record<string, FakeUser> = {
    "auth0|B": { user_id: "auth0|B", email: "wacev92852@mapsguy.com" },
    "auth0|A": {
      user_id: "auth0|A",
      email: "dedes10491@mediseat.com",
      identities: [
        { profileData: { email: "dedes10491@mediseat.com" } },
        { email: "raul.sbdinc@gmail.com", profileData: { email: "raul.sbdinc@gmail.com" } },
      ],
    },
    "auth0|stub": { user_id: "auth0|stub", email: "raul.sbdinc@gmail.com", passwordless: true },
  }

  // Phase 1: enumerate ids from the list (profileData NOT trusted).
  const enumerated = await enumerateOwnershipCandidates<FakeUser>({
    fetchPage: pagedFetcher(listUsers),
    perPage: 10,
    maxPages: 20,
    identify: (u) => u.user_id,
    toCandidate: (u) => ({ userId: u.user_id, ownedEmails: [], hasRealIdentity: !u.passwordless }),
  })
  assert.equal(enumerated.ok, true)

  // Phase 2: hydrate every id via getUser → build ownedEmails from full records.
  const hydrated = await hydrateOwnershipCandidates<FakeUser>({
    userIds: listUsers.map((u) => u.user_id),
    fetchUser: hydrationFetcher(fullById),
    identify: (u) => u.user_id,
    toCandidate: toFakeCandidate,
    concurrency: 5,
  })
  assert.equal(hydrated.ok, true)

  const res = guardResponseFor({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: hydrated.candidates,
    lookupOk: enumerated.ok && hydrated.ok,
  })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.status, 409)
    assert.equal(
      res.error,
      "This email is already used by another account and cannot be added here.",
    )
  }
})

test("route contract: /emails/verify — same-canonical Model 4 → allow (ok:true)", () => {
  // The Gmail lives on the CURRENT account B's own linked identity — adding a new
  // brand credential for it (Model 4 cross-brand) must be allowed.
  const selfOwned: AddEmailCandidate = {
    userId: "auth0|B",
    ownedEmails: collectIdentityOwnedEmails({
      email: "wacev92852@mapsguy.com",
      identities: [{ email: "raul.sbdinc@gmail.com", profileData: { email: "raul.sbdinc@gmail.com" } }],
    }),
    hasRealIdentity: true,
  }
  const res = guardResponseFor({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: [selfOwned],
    lookupOk: true,
  })
  assert.equal(res.ok, true)
})

test("route contract: a failed lookup maps to 502 (fail-closed), never a silent link", () => {
  const res = guardResponseFor({
    email: "raul.sbdinc@gmail.com",
    currentUserId: "auth0|B",
    candidates: [],
    lookupOk: false,
  })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.status, 502)
})

test("route contract: mapper maps each decision reason to its status", () => {
  assert.deepEqual(mapAddEmailGuardResponse({ ok: true }), { ok: true })
  assert.deepEqual(mapAddEmailGuardResponse({ ok: false, reason: "different-owner" }), {
    ok: false,
    status: 409,
    error: "This email is already used by another account and cannot be added here.",
  })
  assert.deepEqual(mapAddEmailGuardResponse({ ok: false, reason: "ambiguous" }), {
    ok: false,
    status: 409,
    error: "This email is already used by another account and cannot be added here.",
  })
  const unavailable = mapAddEmailGuardResponse({ ok: false, reason: "unavailable" })
  assert.equal(unavailable.ok, false)
  if (!unavailable.ok) assert.equal(unavailable.status, 502)
})
