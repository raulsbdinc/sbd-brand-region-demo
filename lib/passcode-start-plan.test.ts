import { test } from "node:test"
import assert from "node:assert/strict"
import { planPasscodeStart } from "./passcode-start-plan.ts"

// LINKED ALTERNATE + SCOPED CREDENTIAL — the live defect.
// A linked alternate email resolves to the passwordless flow (it holds no
// database identity) yet also maps to a per-email binding. The plan MUST keep
// the passwordless email-delivery path and NOT promote it to a database
// challenge (which would send nothing and be swallowed).
test("linked alternate with a resolved per-email binding stays passwordless", () => {
  const plan = planPasscodeStart({
    baseFlow: "passwordless",
    resolutionKind: "resolved",
    resolvedConnectionName: "sbd-demo-per-email",
  })
  assert.equal(plan.flow, "passwordless")
  assert.equal(plan.dbConnectionName, undefined)
  assert.equal(plan.permitsChallenge, true)
})

test("linked alternate with a resolved per-brand binding stays passwordless", () => {
  const plan = planPasscodeStart({
    baseFlow: "passwordless",
    resolutionKind: "resolved",
    resolvedConnectionName: "sbd-demo-dewalt",
  })
  assert.equal(plan.flow, "passwordless")
  assert.equal(plan.dbConnectionName, undefined)
  assert.equal(plan.permitsChallenge, true)
})

// Model 4 only: an email with no bound brand credential ("shared-default")
// never gets a challenge on any default/shared connection.
test("no bound credential (shared-default) never issues a database challenge", () => {
  for (const brandScoped of [false, true]) {
    const plan = planPasscodeStart({
      baseFlow: "database",
      resolutionKind: "shared-default",
      brandScoped,
    })
    assert.equal(plan.dbConnectionName, undefined)
    assert.equal(plan.permitsChallenge, false)
  }
})

// A database-flow email that ALSO resolves to a non-shared credential refines
// the challenge onto that connection — the one legitimate use of the binding.
test("database email with a resolved binding refines onto the resolved connection", () => {
  const plan = planPasscodeStart({
    baseFlow: "database",
    resolutionKind: "resolved",
    resolvedConnectionName: "sbd-demo-per-email",
  })
  assert.equal(plan.flow, "database")
  assert.equal(plan.dbConnectionName, "sbd-demo-per-email")
  assert.equal(plan.permitsChallenge, true)
})

// UNRESOLVED / AMBIGUOUS — fail CLOSED, no realm operation on any flow.
test("ambiguous resolution fails closed (no challenge) on either base flow", () => {
  for (const baseFlow of ["database", "passwordless"] as const) {
    const plan = planPasscodeStart({ baseFlow, resolutionKind: "ambiguous" })
    assert.equal(plan.flow, baseFlow)
    assert.equal(plan.dbConnectionName, undefined)
    assert.equal(plan.permitsChallenge, false)
  }
})

test("unavailable resolution fails closed (no challenge) on either base flow", () => {
  for (const baseFlow of ["database", "passwordless"] as const) {
    const plan = planPasscodeStart({ baseFlow, resolutionKind: "unavailable" })
    assert.equal(plan.flow, baseFlow)
    assert.equal(plan.dbConnectionName, undefined)
    assert.equal(plan.permitsChallenge, false)
  }
})

// A resolved binding without a connection name never fabricates one.
test("resolved database flow without a connection name does not refine", () => {
  const plan = planPasscodeStart({
    baseFlow: "database",
    resolutionKind: "resolved",
    resolvedConnectionName: undefined,
  })
  assert.equal(plan.flow, "database")
  assert.equal(plan.dbConnectionName, undefined)
  assert.equal(plan.permitsChallenge, true)
})
