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

test("no model defaults to the shared (one-password) wording", () => {
  assert.equal(recognitionCopyMode(undefined), "shared")
  assert.match(crossBrandRecognitionCopy(undefined), /one account, one password, one record/)
})

test("EU Models 1/2 shared account keeps the one-password wording", () => {
  assert.equal(recognitionCopyMode(shared), "shared")
  assert.match(crossBrandRecognitionCopy(shared), /one account, one password, one record/)
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
