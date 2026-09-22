// Integration tests for the Model 3 / Model 4 provisioning executor, driven by
// a programmable FAKE tenant (the injectable ManagementDeps). These exercise the
// create → link → bind sequence AND every rollback path without touching Auth0.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  executePerEmailRegistration,
  executeBrandRegistration,
  executeBrandLink,
  executePerEmailLink,
  type ManagementDeps,
} from "./model-registration.ts"
import type { Auth0User } from "./auth0-management.ts"

// --- Fake tenant ------------------------------------------------------------

interface FakeOptions {
  // Force a specific step to throw, to drive rollback paths.
  failCreateFor?: string // email whose createUser throws
  failLinkAt?: number // 1-based count at which linkIdentity throws
  failUpdate?: boolean // updateUser throws
  existing?: Auth0User[] // pre-existing users (collision / getUser source)
  createReturnsNoIdentity?: string // email whose created user has no identities
}

interface FakeState {
  created: string[] // user_ids created
  deleted: string[] // user_ids deleted (rollback)
  linked: string[] // secondary user_ids linked
  unlinked: string[] // secondary user_ids unlinked (rollback)
  updated: Array<{ id: string; bindings: unknown }>
  // Every createUser call's email + the email_verified flag we sent to Auth0,
  // so tests can prove we NEVER mint an unverified identity.
  createdVerified: Array<{ email: string; emailVerified: boolean }>
}

function makeFake(opts: FakeOptions = {}): { deps: ManagementDeps; state: FakeState } {
  const state: FakeState = {
    created: [],
    deleted: [],
    linked: [],
    unlinked: [],
    updated: [],
    createdVerified: [],
  }
  const store = new Map<string, Auth0User>()
  for (const u of opts.existing ?? []) store.set(u.user_id, u)
  let seq = 0
  let linkCount = 0

  const deps: ManagementDeps = {
    async createUser({ connection, email, emailVerified }) {
      state.createdVerified.push({ email, emailVerified })
      if (opts.failCreateFor === email) throw new Error("create failed")
      const id = `auth0|new-${++seq}`
      const identities =
        opts.createReturnsNoIdentity === email
          ? []
          : [{ connection, provider: "auth0", user_id: id.split("|")[1] }]
      const user: Auth0User = { user_id: id, email, identities, app_metadata: {} }
      store.set(id, user)
      state.created.push(id)
      return user
    },
    async deleteUser(userId) {
      state.deleted.push(userId)
      store.delete(userId)
      return null
    },
    async getUser(userId) {
      const u = store.get(userId)
      if (!u) throw new Error("not found")
      return u
    },
    async getUsersByEmail(email) {
      return [...store.values()].filter((u) => u.email?.toLowerCase() === email.toLowerCase())
    },
    async linkIdentity(primaryId, body) {
      linkCount += 1
      if (opts.failLinkAt === linkCount) throw new Error("link failed")
      state.linked.push((body as { user_id: string }).user_id)
      return [] as unknown as ReturnType<ManagementDeps["linkIdentity"]> extends Promise<infer R> ? R : never
    },
    async unlinkIdentity(primaryId, _provider, secondaryId) {
      state.unlinked.push(secondaryId)
      return [] as never
    },
    async updateUser(userId, body) {
      if (opts.failUpdate) throw new Error("update failed")
      const u = store.get(userId)
      if (u) u.app_metadata = { ...(body.app_metadata ?? {}) }
      state.updated.push({
        id: userId,
        bindings: (body.app_metadata as { credential_bindings?: unknown })?.credential_bindings,
      })
      return store.get(userId)!
    },
  }
  return { deps, state }
}

// --- Model 3: primary only --------------------------------------------------

test("per-email registration: primary only creates one user + one binding", async () => {
  const { deps, state } = makeFake()
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [{ email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true }],
    },
    deps,
  )
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.equal(out.credentials.length, 1)
    assert.equal(state.created.length, 1)
    assert.equal(state.deleted.length, 0)
    assert.equal(state.updated.length, 1)
    assert.equal((state.updated[0].bindings as unknown[]).length, 1)
  }
})

// --- Model 3: primary + second ---------------------------------------------

test("per-email registration: primary + second creates two users, links + binds both", async () => {
  const { deps, state } = makeFake()
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [
        { email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true },
        { email: "b@example.com", password: "supersecret2", role: "secondary", emailVerified: true },
      ],
    },
    deps,
  )
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.equal(out.credentials.length, 2)
    assert.equal(state.created.length, 2)
    assert.equal(state.linked.length, 1)
    assert.equal(state.deleted.length, 0)
    assert.equal((state.updated[0].bindings as unknown[]).length, 2)
  }
})

// --- Model 3 rollback: second create fails ---------------------------------

test("per-email registration: ROLLBACK when the second create fails (primary is deleted)", async () => {
  const { deps, state } = makeFake({ failCreateFor: "b@example.com" })
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [
        { email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true },
        { email: "b@example.com", password: "supersecret2", role: "secondary", emailVerified: true },
      ],
    },
    deps,
  )
  assert.equal(out.ok, false)
  // The primary that WAS created must be rolled back.
  assert.equal(state.created.length, 1)
  assert.deepEqual(state.deleted, state.created)
  assert.equal(state.updated.length, 0)
})

// --- Model 3 rollback: link fails ------------------------------------------

test("per-email registration: ROLLBACK when linking the second fails (both users deleted, none left linked)", async () => {
  const { deps, state } = makeFake({ failLinkAt: 1 })
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [
        { email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true },
        { email: "b@example.com", password: "supersecret2", role: "secondary", emailVerified: true },
      ],
    },
    deps,
  )
  assert.equal(out.ok, false)
  assert.equal(state.created.length, 2)
  assert.equal(state.deleted.length, 2) // both rolled back
  assert.equal(state.linked.length, 0)
})

// --- Model 3 rollback: bind (updateUser) fails ------------------------------

test("per-email registration: ROLLBACK when persisting bindings fails (unlink + delete secondary, delete primary)", async () => {
  const { deps, state } = makeFake({ failUpdate: true })
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [
        { email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true },
        { email: "b@example.com", password: "supersecret2", role: "secondary", emailVerified: true },
      ],
    },
    deps,
  )
  assert.equal(out.ok, false)
  assert.equal(state.created.length, 2)
  assert.equal(state.deleted.length, 2)
  assert.equal(state.unlinked.length, 1) // the linked secondary was unlinked
})

// --- Model 3: collision fails closed BEFORE any create ----------------------

test("per-email registration: fails closed on collision without creating anything", async () => {
  const existing: Auth0User = {
    user_id: "auth0|exists",
    email: "a@example.com",
    identities: [{ connection: "sbd-demo-per-email", provider: "auth0", user_id: "exists" }],
  }
  const { deps, state } = makeFake({ existing: [existing] })
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [{ email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true }],
    },
    deps,
  )
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.status, 409)
  assert.equal(state.created.length, 0)
})

// --- Model 3: weak password rejected before any IO --------------------------

test("per-email registration: rejects a short password with no tenant calls", async () => {
  const { deps, state } = makeFake()
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [{ email: "a@example.com", password: "short", role: "primary", emailVerified: true }],
    },
    deps,
  )
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.status, 400)
  assert.equal(state.created.length, 0)
})

// --- Model 3: NEVER mint an unverified identity -----------------------------

test("per-email registration: refuses to create when an identity is unproven (email_verified false)", async () => {
  const { deps, state } = makeFake()
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [{ email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: false }],
    },
    deps,
  )
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.status, 403)
  // The guard runs BEFORE any tenant IO — nothing was created.
  assert.equal(state.created.length, 0)
  assert.equal(state.createdVerified.length, 0)
})

test("per-email registration: refuses if EITHER email in a pair is unproven (all-or-nothing)", async () => {
  const { deps, state } = makeFake()
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [
        { email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true },
        { email: "b@example.com", password: "supersecret2", role: "secondary", emailVerified: false },
      ],
    },
    deps,
  )
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.status, 403)
  assert.equal(state.created.length, 0)
})

test("per-email registration: proven identities are minted email_verified true (stamped, not inferred)", async () => {
  const { deps, state } = makeFake()
  const out = await executePerEmailRegistration(
    {
      connectionKey: "per-email",
      connectionName: "sbd-demo-per-email",
      identities: [
        { email: "a@example.com", password: "supersecret1", role: "primary", emailVerified: true },
        { email: "b@example.com", password: "supersecret2", role: "secondary", emailVerified: true },
      ],
    },
    deps,
  )
  assert.equal(out.ok, true)
  // Both createUser calls received email_verified: true from the executor.
  assert.equal(state.createdVerified.length, 2)
  assert.ok(state.createdVerified.every((c) => c.emailVerified === true))
})

// --- Model 4: first-brand registration --------------------------------------

test("brand registration: creates a fresh primary with one per-brand binding", async () => {
  const { deps, state } = makeFake()
  const out = await executeBrandRegistration(
    {
      connectionKey: "dewalt",
      connectionName: "sbd-demo-dewalt",
      email: "new@example.com",
      password: "supersecret1",
      brand: "dewalt",
    },
    deps,
  )
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.equal(out.credentials.length, 1)
    assert.equal(out.credentials[0].brand, "dewalt")
    assert.equal(state.created.length, 1)
    assert.equal(state.createdVerified[0]?.emailVerified, false)
    assert.equal(state.linked.length, 0) // primary account, nothing to link
    assert.equal(state.deleted.length, 0)
    assert.equal((state.updated[0].bindings as unknown[]).length, 1)
  }
})

test("brand registration: fails closed on a brand collision without creating", async () => {
  const existing: Auth0User = {
    user_id: "auth0|exists",
    email: "new@example.com",
    identities: [{ connection: "sbd-demo-dewalt", provider: "auth0", user_id: "exists" }],
  }
  const { deps, state } = makeFake({ existing: [existing] })
  const out = await executeBrandRegistration(
    {
      connectionKey: "dewalt",
      connectionName: "sbd-demo-dewalt",
      email: "new@example.com",
      password: "supersecret1",
      brand: "dewalt",
    },
    deps,
  )
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.status, 409)
  assert.equal(state.created.length, 0)
})

test("brand registration: ROLLBACK when persisting the binding fails", async () => {
  const { deps, state } = makeFake({ failUpdate: true })
  const out = await executeBrandRegistration(
    {
      connectionKey: "stanley",
      connectionName: "sbd-demo-stanley",
      email: "new@example.com",
      password: "supersecret1",
      brand: "stanley",
    },
    deps,
  )
  assert.equal(out.ok, false)
  assert.equal(state.created.length, 1)
  assert.deepEqual(state.deleted, state.created) // the fresh primary is deleted
})

// --- Model 4: brand link success --------------------------------------------

test("brand link: creates + links + binds the brand identity under the proven primary", async () => {
  const primary: Auth0User = {
    user_id: "auth0|primary",
    email: "user@example.com",
    identities: [{ connection: "sbd-demo-dewalt", provider: "auth0", user_id: "primary" }],
    app_metadata: {},
  }
  const { deps, state } = makeFake({ existing: [primary] })
  const out = await executeBrandLink(
    {
      primaryUserId: "auth0|primary",
      connectionKey: "stanley",
      connectionName: "sbd-demo-stanley",
      email: "user@example.com",
      password: "supersecret1",
      brand: "stanley",
    },
    deps,
  )
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.equal(out.credentials[0].brand, "stanley")
    assert.equal(state.linked.length, 1)
    assert.equal(state.deleted.length, 0)
  }
})

// --- Model 4 rollback: bind fails after link --------------------------------

test("brand link: ROLLBACK when bind fails (unlink + delete the new identity)", async () => {
  const primary: Auth0User = {
    user_id: "auth0|primary",
    email: "user@example.com",
    identities: [{ connection: "sbd-demo-dewalt", provider: "auth0", user_id: "primary" }],
    app_metadata: {},
  }
  const { deps, state } = makeFake({ existing: [primary], failUpdate: true })
  const out = await executeBrandLink(
    {
      primaryUserId: "auth0|primary",
      connectionKey: "stanley",
      connectionName: "sbd-demo-stanley",
      email: "user@example.com",
      password: "supersecret1",
      brand: "stanley",
    },
    deps,
  )
  assert.equal(out.ok, false)
  assert.equal(state.unlinked.length, 1)
  assert.equal(state.deleted.length, 1)
})

// --- Model 3 completion: per-email link ------------------------------------

test("per-email link (completion): links a verified second email under the primary", async () => {
  const primary: Auth0User = {
    user_id: "auth0|primary",
    email: "a@example.com",
    identities: [{ connection: "sbd-demo-per-email", provider: "auth0", user_id: "primary" }],
    app_metadata: {},
  }
  const { deps, state } = makeFake({ existing: [primary] })
  const out = await executePerEmailLink(
    {
      primaryUserId: "auth0|primary",
      connectionName: "sbd-demo-per-email",
      email: "b@example.com",
      password: "supersecret2",
    },
    deps,
  )
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.equal(out.credentials[0].email, "b@example.com")
    assert.equal(state.linked.length, 1)
  }
})
