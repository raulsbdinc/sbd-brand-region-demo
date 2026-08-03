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

/** Defaults applied when a user has never saved preferences. */
export const DEFAULT_PREFERENCES: SitePreferences = {
  preferred_brand: "dewalt",
  preferred_country: "us",
  preferred_locale: "en-US",
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
