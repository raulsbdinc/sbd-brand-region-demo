// TYPED user_metadata SCHEMA + RUNTIME ALLOW-LIST
// ================================================
// Single source of truth for the user-editable "site preferences" that live in
// Auth0 `user_metadata` (see FEATURE_BACKLOG.md Part 4 §4.3). Shared by:
//
//   • app/api/account/preferences/route.ts — server: sanitizes writes against
//     this allow-list so a client can never stash arbitrary keys in the
//     directory record.
//   • components/real-account.tsx          — client: renders the form options
//     and seeds Demo state from DEFAULT_PREFERENCES.
//
// The golden rule (FEATURE_BACKLOG.md Part 4 §4.1): everything here is a PREFERENCE — it
// never changes what the user is allowed to do or see. Access-affecting values
// belong in `app_metadata` and are never writable from the account center.
//
// This module is intentionally framework-free (no "server-only") so the option
// lists + types can be imported by the client component too.

import { BRAND_ORDER, BRANDS, COUNTRY_ORDER, COUNTRIES, regionForCountry } from "./brands"
import { SITE_BRAND, SITE_COUNTRY, SITE_MARKET } from "./site"
import type { BrandId, CountryId } from "./types"

export type CommunicationChannel = "email" | "sms" | "push"
export type PreferredLogin = "auto" | "passkey" | "password" | "social"

/** The complete, validated shape we read/write under `user_metadata`. */
export interface SitePreferences {
  /** Favorite SBD brand — a display preference, NOT an entitlement. */
  preferred_brand: BrandId
  /** Region used to tailor the storefront. NOT data-residency (that's app_metadata.home_region). */
  preferred_country: CountryId
  /** BCP-47 UI language preference, e.g. "en-US". */
  preferred_locale: string
  /** Email language (Auth0 docs call this field out by name), e.g. "en". */
  lang: string
  /** Current marketing toggle state. A best-effort change log may be written to the DB. */
  marketing_opt_in: boolean
  /** Per-channel communication preferences. */
  communication_prefs: Record<CommunicationChannel, boolean>
  /** UX hint — which sign-in method to surface first. Does not grant access. */
  preferred_login: PreferredLogin
}

// Defaults applied when a user has never saved preferences.
//
// These are PER-DEPLOYMENT: brand, country and locale are derived from this
// build's own identity (lib/site.ts), not hardcoded. One build serves all three
// sites, so a new user who signs up on, say, Craftsman France must start with
// Craftsman / France / fr-FR — their own brand and market — rather than someone
// else's (the old hardcoded DeWalt / US / en-US made every new account look like
// a DeWalt US user regardless of the site they joined on).
//
// `lang` is deliberately NOT derived: it is the interface language, and every
// site's copy is English by design (the document element is hardcoded to
// lang="en" — see DEMO_STATUS.md). `preferred_locale` is a data preference and
// follows the market; `lang` is the UI language and stays "en".
export const DEFAULT_PREFERENCES: SitePreferences = {
  preferred_brand: SITE_BRAND,
  preferred_country: SITE_MARKET,
  preferred_locale: SITE_COUNTRY.locale,
  lang: "en",
  marketing_opt_in: false,
  communication_prefs: { email: true, sms: false, push: false },
  preferred_login: "auto",
}

// --- Option lists for the UI (derived where possible) ----------------------

export const BRAND_OPTIONS = BRAND_ORDER.map((id) => ({
  value: id,
  label: BRANDS[id].name,
}))

export const COUNTRY_OPTIONS = COUNTRY_ORDER.map((id) => ({
  value: id,
  label: COUNTRIES[id].name,
  locale: COUNTRIES[id].locale,
}))

/** UI locales offered — the distinct locales of the supported countries. */
export const LOCALE_OPTIONS = COUNTRY_ORDER.map((id) => ({
  value: COUNTRIES[id].locale,
  label: `${COUNTRIES[id].name} (${COUNTRIES[id].locale})`,
}))

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
]

export const COMMUNICATION_CHANNELS: {
  value: CommunicationChannel
  label: string
  description: string
}[] = [
  { value: "email", label: "Email", description: "Order updates and account notices" },
  { value: "sms", label: "SMS", description: "Time-sensitive alerts by text message" },
  { value: "push", label: "Push", description: "Mobile app push notifications" },
]

export const PREFERRED_LOGIN_OPTIONS: { value: PreferredLogin; label: string }[] = [
  { value: "auto", label: "Let me choose each time" },
  { value: "passkey", label: "Passkey" },
  { value: "password", label: "Email & password" },
  { value: "social", label: "A social account" },
]

// --- Validation helpers ----------------------------------------------------

const BRAND_IDS = new Set<string>(BRAND_ORDER)
const COUNTRY_IDS = new Set<string>(COUNTRY_ORDER)
const LOCALES = new Set(LOCALE_OPTIONS.map((o) => o.value))
const LANGS = new Set(LANGUAGE_OPTIONS.map((o) => o.value))
const LOGINS = new Set<PreferredLogin>(["auto", "passkey", "password", "social"])

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback
}

/**
 * Merge a raw `user_metadata`-ish object over the defaults, keeping ONLY known
 * keys with valid values. Used both to read stored prefs and to sanitize an
 * incoming PATCH body — there is no path for an unknown key to be written.
 */
export function sanitizePreferences(input: unknown): SitePreferences {
  const raw = (input ?? {}) as Record<string, unknown>
  const incomingComms = (raw.communication_prefs ?? {}) as Record<string, unknown>

  return {
    preferred_brand: BRAND_IDS.has(raw.preferred_brand as string)
      ? (raw.preferred_brand as BrandId)
      : DEFAULT_PREFERENCES.preferred_brand,
    preferred_country: COUNTRY_IDS.has(raw.preferred_country as string)
      ? (raw.preferred_country as CountryId)
      : DEFAULT_PREFERENCES.preferred_country,
    preferred_locale: LOCALES.has(raw.preferred_locale as string)
      ? (raw.preferred_locale as string)
      : DEFAULT_PREFERENCES.preferred_locale,
    lang: LANGS.has(raw.lang as string)
      ? (raw.lang as string)
      : DEFAULT_PREFERENCES.lang,
    marketing_opt_in: asBool(raw.marketing_opt_in, DEFAULT_PREFERENCES.marketing_opt_in),
    communication_prefs: {
      email: asBool(incomingComms.email, DEFAULT_PREFERENCES.communication_prefs.email),
      sms: asBool(incomingComms.sms, DEFAULT_PREFERENCES.communication_prefs.sms),
      push: asBool(incomingComms.push, DEFAULT_PREFERENCES.communication_prefs.push),
    },
    preferred_login: LOGINS.has(raw.preferred_login as PreferredLogin)
      ? (raw.preferred_login as PreferredLogin)
      : DEFAULT_PREFERENCES.preferred_login,
  }
}

// --- Saved addresses (user_metadata.addresses) -----------------------------
// A customer's saved shipping / billing addresses, stored as an array under
// `user_metadata.addresses`. Written by /api/account/addresses and rendered on
// the customer profile (/profile). Same defensive contract as the preference
// sanitiser above: NEVER throw on malformed stored data — read whatever is
// valid, silently drop the rest — so one bad row can never blank the section or
// crash a write.

export type AddressType = "shipping" | "billing"

/** One saved address. All string fields are trimmed + length-capped on write. */
export interface Address {
  id: string
  /** Friendly label the customer gives it, e.g. "Home", "Workshop". */
  label: string
  type: AddressType
  /** Who the parcel is addressed to. */
  recipient: string
  line1: string
  line2: string
  city: string
  /** State / province / county. Not used by every market's format. */
  region: string
  postal_code: string
  /** Free-text country name; defaults to this deployment's market. */
  country: string
  /** At most one address per type may be the default (enforced on write). */
  is_default: boolean
}

/** Default country for a new address on this deployment (its own market). */
export const DEFAULT_ADDRESS_COUNTRY: string = SITE_COUNTRY.name

const ADDRESS_TYPES = new Set<AddressType>(["shipping", "billing"])

/**
 * Order of the town / region / postcode group, appropriate to this
 * deployment's market. Continental-European markets (this repo ships France
 * and Germany) write the postcode before the town and omit a state/region line;
 * the other markets put town, then state/region, then postcode last. The
 * `region` field is still stored either way — it is simply not surfaced in the
 * European layout.
 */
export type AddressLocalityField = "city" | "region" | "postal_code"
const EUROPEAN_ADDRESS_MARKETS = new Set<CountryId>(["fr", "de"])
export const ADDRESS_LOCALITY_ORDER: AddressLocalityField[] =
  EUROPEAN_ADDRESS_MARKETS.has(SITE_MARKET)
    ? ["postal_code", "city"]
    : ["city", "region", "postal_code"]

function asTrimmed(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : ""
}

/** Generate a stable id for a new address. Falls back if crypto is unavailable. */
export function newAddressId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `addr_${crypto.randomUUID().slice(0, 8)}`
    }
  } catch {
    // fall through
  }
  return `addr_${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Normalize one raw address-ish value. Returns null (→ dropped) when the entry
 * is not an object or carries no meaningful content (no recipient AND no
 * street line), so junk never survives a read or a write. A missing/blank id is
 * assigned a fresh one; a missing country falls back to this market.
 */
export function sanitizeAddress(input: unknown): Address | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>

  const recipient = asTrimmed(raw.recipient, 120)
  const line1 = asTrimmed(raw.line1, 200)
  // An address with neither a recipient nor a street line is not an address.
  if (!recipient && !line1) return null

  return {
    id: asTrimmed(raw.id, 40) || newAddressId(),
    label: asTrimmed(raw.label, 60) || "Address",
    type: ADDRESS_TYPES.has(raw.type as AddressType)
      ? (raw.type as AddressType)
      : "shipping",
    recipient,
    line1,
    line2: asTrimmed(raw.line2, 200),
    city: asTrimmed(raw.city, 120),
    region: asTrimmed(raw.region, 120),
    postal_code: asTrimmed(raw.postal_code, 32),
    country: asTrimmed(raw.country, 80) || DEFAULT_ADDRESS_COUNTRY,
    is_default: asBool(raw.is_default, false),
  }
}

/**
 * Keep at most ONE default per type: the first default seen for a type wins,
 * any later ones are demoted. Order the input so a just-selected default comes
 * first if you want it to be the surviving one.
 */
export function enforceSingleDefaultPerType(addresses: Address[]): Address[] {
  const claimed: Record<AddressType, boolean> = { shipping: false, billing: false }
  return addresses.map((a) => {
    if (a.is_default && !claimed[a.type]) {
      claimed[a.type] = true
      return a
    }
    return a.is_default ? { ...a, is_default: false } : a
  })
}

/**
 * Read an entire stored `user_metadata.addresses` value into a clean array:
 * drop non-objects and empty rows, de-duplicate ids, and collapse to one
 * default per type. Used both to read the section and to re-validate every
 * write before it is persisted.
 */
export function sanitizeAddresses(input: unknown): Address[] {
  const arr = Array.isArray(input) ? input : []
  const out: Address[] = []
  const seenIds = new Set<string>()
  for (const item of arr) {
    const a = sanitizeAddress(item)
    if (!a) continue
    if (seenIds.has(a.id)) a.id = newAddressId()
    seenIds.add(a.id)
    out.push(a)
  }
  return enforceSingleDefaultPerType(out)
}

// --- Saved phone numbers (user_metadata.phones) ----------------------------
// A customer's saved phone numbers, stored as an array under
// `user_metadata.phones`. Written by /api/account/phones and rendered on the
// customer profile (/profile). Numbers are held as an account IDENTIFIER today;
// text-message sign-in / verification turns on when an SMS provider is
// connected to the tenant (a configuration change, not new development). Same
// defensive contract as the address sanitiser: NEVER throw on malformed stored
// data — read whatever is valid, silently drop the rest.

/** One saved phone number, stored in E.164 (e.g. "+33612345678"). */
export interface Phone {
  id: string
  /** Friendly label the customer gives it, e.g. "Mobile", "Work". */
  label: string
  /** The number in E.164 form: a leading "+", country code, then digits. */
  e164: string
  /** At most one phone may be the default (enforced on write). */
  is_default: boolean
}

// Country dialling codes for the markets this repo can be built as. Used only
// to pre-fill the "+" prefix for a NEW number on this deployment; a customer
// can always type a number for any country. Unknown markets fall back to a bare
// "+", which still validates once the customer types their country code.
const COUNTRY_DIAL_CODES: Partial<Record<CountryId, string>> = {
  us: "+1",
  ca: "+1",
  uk: "+44",
  fr: "+33",
  de: "+49",
  au: "+61",
}

/** Default "+" dialling prefix for a new number on this deployment's market. */
export const DEFAULT_PHONE_PREFIX: string = COUNTRY_DIAL_CODES[SITE_MARKET] ?? "+"

// E.164: a "+" then a non-zero country-code digit, then up to 14 more digits
// (15 significant digits max, per the ITU standard).
const E164_RE = /^\+[1-9]\d{6,14}$/

/** Whether a string is a valid E.164 phone number. */
export function isValidE164(v: string): boolean {
  return E164_RE.test(v)
}

/** Strip spaces, hyphens and brackets so "+33 6 12-34" → "+33612 34". */
export function normalizePhoneInput(v: string): string {
  return v.replace(/[\s()\-.]/g, "")
}

/** Generate a stable id for a new phone. Falls back if crypto is unavailable. */
export function newPhoneId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `tel_${crypto.randomUUID().slice(0, 8)}`
    }
  } catch {
    // fall through
  }
  return `tel_${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Normalize one raw phone-ish value. Returns null (→ dropped) when the entry is
 * not an object or does not carry a valid E.164 number, so junk never survives
 * a read or a write. A missing/blank id is assigned a fresh one.
 */
export function sanitizePhone(input: unknown): Phone | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>

  const e164 = normalizePhoneInput(asTrimmed(raw.e164, 24))
  if (!isValidE164(e164)) return null

  return {
    id: asTrimmed(raw.id, 40) || newPhoneId(),
    label: asTrimmed(raw.label, 60) || "Phone",
    e164,
    is_default: asBool(raw.is_default, false),
  }
}

/** Keep at most ONE default phone: the first default seen wins, rest demoted. */
export function enforceSinglePhoneDefault(phones: Phone[]): Phone[] {
  let claimed = false
  return phones.map((p) => {
    if (p.is_default && !claimed) {
      claimed = true
      return p
    }
    return p.is_default ? { ...p, is_default: false } : p
  })
}

/**
 * Read an entire stored `user_metadata.phones` value into a clean array: drop
 * non-objects and invalid numbers, de-duplicate ids and E.164 values, and
 * collapse to one default. Used both to read the section and to re-validate
 * every write before it is persisted.
 */
export function sanitizePhones(input: unknown): Phone[] {
  const arr = Array.isArray(input) ? input : []
  const out: Phone[] = []
  const seenIds = new Set<string>()
  const seenNumbers = new Set<string>()
  for (const item of arr) {
    const p = sanitizePhone(item)
    if (!p) continue
    if (seenNumbers.has(p.e164)) continue // same number twice → keep the first
    if (seenIds.has(p.id)) p.id = newPhoneId()
    seenIds.add(p.id)
    seenNumbers.add(p.e164)
    out.push(p)
  }
  return enforceSinglePhoneDefault(out)
}

// --- Consent management (user_metadata.consent) ----------------------------
// Consent is the lawful-basis layer (GDPR/CCPA): WHETHER the user agrees to a
// kind of processing. It is deliberately separate from SitePreferences:
//
//   • It lives under its own `user_metadata.consent` key and is written by its
//     own route (/api/account/consent), which shallow-merges just `consent`
//     (+ a `consent_updated_at` stamp) so saving consent never clobbers the
//     site preferences object, and vice-versa.
//   • Withdrawable consents only. "Essential" / necessary processing (security,
//     fraud prevention, fulfilling a contract) is NOT consent-based and is not
//     listed here.
//
// This stores the current state plus a single last-updated stamp. The app can
// also attempt a best-effort append to Neon. Auth0 metadata is not an audit log,
// and this POC does not promise complete or tamper-proof consent evidence.

export type ConsentTopic =
  | "marketing"
  | "data_sharing"
  | "analytics"
  | "personalization"

/** The consent topics presented in the account center, in display order. */
export const CONSENT_TOPICS: {
  value: ConsentTopic
  label: string
  description: string
}[] = [
  {
    value: "marketing",
    label: "Marketing communications",
    description:
      "Consent to receive product news, promotions, and tips. Delivery channels are configured in Site preferences.",
  },
  {
    value: "data_sharing",
    label: "Data sharing with SBD brands & partners",
    description:
      "Allow your profile to be shared across Stanley Black & Decker brands and selected partners.",
  },
  {
    value: "analytics",
    label: "Usage analytics",
    description:
      "Allow analytics on how you use our sites and apps so we can improve them.",
  },
  {
    value: "personalization",
    label: "Personalized experience",
    description:
      "Use your activity to tailor content, product recommendations, and offers.",
  },
]

export type ConsentState = Record<ConsentTopic, boolean>

/** Consent defaults — opt-IN model: everything off until explicitly granted. */
export const DEFAULT_CONSENT: ConsentState = {
  marketing: false,
  data_sharing: false,
  analytics: false,
  personalization: false,
}

const CONSENT_KEYS = new Set<string>(CONSENT_TOPICS.map((t) => t.value))

/**
 * Merge a raw `user_metadata.consent`-ish object over the defaults, keeping
 * ONLY known consent topics with boolean values. Used to read stored consent
 * and to sanitize an incoming PATCH body.
 */
export function sanitizeConsent(input: unknown): ConsentState {
  const raw = (input ?? {}) as Record<string, unknown>
  const out = { ...DEFAULT_CONSENT }
  for (const key of CONSENT_KEYS) {
    out[key as ConsentTopic] = asBool(raw[key], DEFAULT_CONSENT[key as ConsentTopic])
  }
  return out
}

// --- Mock metadata synthesis (for the Token inspector demo) ----------------
// When there is no live, Management-API-backed session, the Token inspector
// still wants to teach the "claims vs. directory" story. We synthesize a
// plausible pair of records from the in-app session so the panel is never
// empty — clearly labeled as simulated. user_metadata mirrors the editable
// site preferences; app_metadata holds the access-affecting values (roles,
// muid, data-residency region) that a real Action would read.

export interface SyntheticMetadata {
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
}

export function synthesizeMockMetadata(opts: {
  roles: string[]
  muid: string
  brand: BrandId
  country: CountryId
}): SyntheticMetadata {
  const region = regionForCountry(opts.country)
  return {
    user_metadata: {
      preferred_brand: opts.brand,
      preferred_country: opts.country,
      preferred_locale: COUNTRIES[opts.country].locale,
      lang: DEFAULT_PREFERENCES.lang,
      marketing_opt_in: DEFAULT_PREFERENCES.marketing_opt_in,
      communication_prefs: DEFAULT_PREFERENCES.communication_prefs,
      preferred_login: DEFAULT_PREFERENCES.preferred_login,
      consent: { ...DEFAULT_CONSENT, marketing: opts.roles.includes("pro") },
    },
    app_metadata: {
      muid: opts.muid,
      roles: opts.roles,
      home_region: region,
      tier: opts.roles.includes("pro") ? "pro" : "standard",
      account_status: "active",
    },
  }
}
