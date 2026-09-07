import { test } from "node:test"
import assert from "node:assert/strict"
import {
  methodRowRightSlotClass,
  passwordRowRightIsWrappingStatus,
} from "./method-row-layout.ts"

// GLSCM-4834: the live blocker was a non-action text status ("Managed in Brand
// passwords above") rendered in a `shrink-0` slot, forcing the Model 4 sign-in
// row to its max-content width and creating horizontal overflow at 390px.

test("action button right slot stays shrink-0 (never wraps or shrinks)", () => {
  const cls = methodRowRightSlotClass(false)
  assert.equal(cls, "shrink-0")
  // It must NOT allow shrinking — that is what keeps a real button intact.
  assert.ok(!cls.includes("min-w-0"))
  assert.ok(!cls.includes("shrink text-right"))
})

test("text-status right slot may shrink and wrap (no forced max-content width)", () => {
  const cls = methodRowRightSlotClass(true)
  // min-w-0 lets the flex item shrink below its content width; `shrink` lets it
  // give up space so the long status wraps instead of overflowing the row.
  assert.ok(cls.includes("min-w-0"))
  assert.ok(cls.includes("shrink"))
  assert.ok(!cls.includes("shrink-0"))
})

test("brand-suppressed status ('Managed in Brand passwords above') wraps", () => {
  // The exact live-failure case: Model 4 brand credential row pointing up to the
  // Brand passwords section. It is a non-action status → must wrap.
  assert.equal(
    passwordRowRightIsWrappingStatus({
      suppressChange: true,
      hasChangeTarget: true,
    }),
    true,
  )
})

test("account-managed status (no change target) wraps", () => {
  assert.equal(
    passwordRowRightIsWrappingStatus({
      suppressChange: false,
      hasChangeTarget: false,
    }),
    true,
  )
})

test("a real Change action does NOT wrap (button keeps shrink-0)", () => {
  assert.equal(
    passwordRowRightIsWrappingStatus({
      suppressChange: false,
      hasChangeTarget: true,
    }),
    false,
  )
})

test("suppressed brand row without a target still wraps", () => {
  assert.equal(
    passwordRowRightIsWrappingStatus({
      suppressChange: true,
      hasChangeTarget: false,
    }),
    true,
  )
})

test("wrapping decision maps to the shrink-friendly class end-to-end", () => {
  // The two overflow-prone statuses resolve to a shrinkable slot...
  for (const args of [
    { suppressChange: true, hasChangeTarget: true },
    { suppressChange: false, hasChangeTarget: false },
  ]) {
    const cls = methodRowRightSlotClass(
      passwordRowRightIsWrappingStatus(args),
    )
    assert.ok(cls.includes("min-w-0"), JSON.stringify(args))
    assert.ok(!cls.includes("shrink-0"), JSON.stringify(args))
  }
  // ...while a real action resolves to the rigid, non-shrinking slot.
  const actionCls = methodRowRightSlotClass(
    passwordRowRightIsWrappingStatus({
      suppressChange: false,
      hasChangeTarget: true,
    }),
  )
  assert.equal(actionCls, "shrink-0")
})
