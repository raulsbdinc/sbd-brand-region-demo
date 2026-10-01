import { test } from "node:test"
import assert from "node:assert/strict"
import {
  crossBrandRecognitionCopy,
  recognitionCopyMode,
} from "./cross-brand-copy.ts"
import type { PasswordModelSummary } from "./credential-model.ts"

const shared: PasswordModelSummary = {
  singleSharedPassword: true,
  perBrand: false,
  perEmail: false,
  brands: [],
}
const perBrand: PasswordModelSummary = {
  singleSharedPassword: false,
  perBrand: true,
  perEmail: false,
  brands: ["dewalt"],
}
const perEmail: PasswordModelSummary = {
  singleSharedPassword: false,
  perBrand: false,
  perEmail: true,
  brands: [],
}

test("no model: default copy never claims a shared password (Model 4 only)", () => {
  assert.equal(recognitionCopyMode(undefined), "shared")
  const copy = crossBrandRecognitionCopy(undefined)
  assert.doesNotMatch(copy, /one password|one account, one password/i)
  assert.match(copy, /Each brand uses its own password/)
})

test("shared-looking model: copy never claims one password across sites", () => {
  assert.equal(recognitionCopyMode(shared), "shared")
  assert.doesNotMatch(crossBrandRecognitionCopy(shared), /one password/i)
})

test("no recognition mode claims one password across sites", () => {
  for (const m of [undefined, shared, perBrand, perEmail]) {
    for (const resolved of [true, false]) {
      assert.doesNotMatch(crossBrandRecognitionCopy(m, resolved), /one password|works across/i)
    }
  }
})

test("UK Model 4 per-brand copy does NOT claim one password", () => {
  assert.equal(recognitionCopyMode(perBrand), "per-brand")
  const copy = crossBrandRecognitionCopy(perBrand)
  assert.doesNotMatch(copy, /one password/)
  // States the true model: one customer/account record, separate brand passwords.
  assert.match(copy, /one customer account/)
  assert.match(copy, /separate password/)
  assert.match(copy, /each brand/)
})

test("UK Model 3 per-email copy does NOT claim one password", () => {
  assert.equal(recognitionCopyMode(perEmail), "per-email")
  const copy = crossBrandRecognitionCopy(perEmail)
  assert.doesNotMatch(copy, /one password/)
  assert.match(copy, /one customer record/)
  assert.match(copy, /separate password/)
})

test("per-brand takes precedence when both per-brand and per-email are set", () => {
  const both: PasswordModelSummary = {
    singleSharedPassword: false,
    perBrand: true,
    perEmail: true,
    brands: ["dewalt"],
  }
  assert.equal(recognitionCopyMode(both), "per-brand")
})

test("unresolved model claims no password count (Model 4 loading window)", () => {
  // The live profile derives the real model from a second request. On first
  // render it is unresolved and an empty model summarises as a single shared
  // password — passing resolved:false must suppress the "one password" claim so
  // a per-brand (Model 4) account never flashes "one account, one password".
  assert.equal(recognitionCopyMode(undefined, false), "unresolved")
  const copy = crossBrandRecognitionCopy(undefined, false)
  assert.doesNotMatch(copy, /one password/)
  assert.doesNotMatch(copy, /separate password/)
  // Still true for every model: same account, one directory record.
  assert.match(copy, /same account/)
  assert.match(copy, /one record/)
})

test("resolved:false overrides even a shared-looking model", () => {
  // The exact defect: right after Model 4 activation the empty methods list
  // summarises as `shared`, but the topology is not actually known yet.
  assert.equal(recognitionCopyMode(shared, false), "unresolved")
  assert.doesNotMatch(crossBrandRecognitionCopy(shared, false), /one password/)
})

test("resolved defaults to true so existing callers are unchanged", () => {
  assert.equal(recognitionCopyMode(perBrand), recognitionCopyMode(perBrand, true))
  assert.equal(recognitionCopyMode(shared), "shared")
  assert.doesNotMatch(crossBrandRecognitionCopy(shared), /one password/i)
})
