export const PROGRESSIVE_PROFILE_FIELDS = [
  "given_name",
  "family_name",
  "phone_number",
] as const

export type ProgressiveProfileField = (typeof PROGRESSIVE_PROFILE_FIELDS)[number]

export interface ProgressiveProfileValues {
  given_name: string
  family_name: string
  phone_number: string
}

export interface ProgressiveProfileState {
  values: ProgressiveProfileValues
  missing: ProgressiveProfileField[]
  complete: boolean
  dismissed: boolean
  shouldPrompt: boolean
  completedAt: string | null
  dismissedAt: string | null
}

export const EMPTY_PROGRESSIVE_PROFILE: ProgressiveProfileValues = {
  given_name: "",
  family_name: "",
  phone_number: "",
}

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,79}$/u
const PHONE_PATTERN = /^[+()\d][\d\s().-]{4,}$/

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function validateProgressiveProfileField(
  field: ProgressiveProfileField,
  value: unknown,
): string | null {
  const cleaned = cleanString(value)
  if (!cleaned) return "This field is required."

  if (field === "phone_number") {
    return PHONE_PATTERN.test(cleaned) ? null : "Enter a valid phone number."
  }

  return NAME_PATTERN.test(cleaned)
    ? null
    : "Use letters, spaces, apostrophes, periods, or hyphens."
}

export function sanitizeProgressiveProfile(
  input: unknown,
  fields: readonly ProgressiveProfileField[] = PROGRESSIVE_PROFILE_FIELDS,
): {
  values: Partial<ProgressiveProfileValues>
  errors: Partial<Record<ProgressiveProfileField, string>>
} {
  const raw = (input ?? {}) as Record<string, unknown>
  const values: Partial<ProgressiveProfileValues> = {}
  const errors: Partial<Record<ProgressiveProfileField, string>> = {}

  for (const field of fields) {
    const error = validateProgressiveProfileField(field, raw[field])
    if (error) errors[field] = error
    else values[field] = cleanString(raw[field])
  }

  return { values, errors }
}

export function progressiveProfileState(user: {
  given_name?: unknown
  family_name?: unknown
  user_metadata?: unknown
}): ProgressiveProfileState {
  const metadata =
    typeof user.user_metadata === "object" && user.user_metadata !== null
      ? (user.user_metadata as Record<string, unknown>)
      : {}
  const values: ProgressiveProfileValues = {
    given_name: cleanString(user.given_name),
    family_name: cleanString(user.family_name),
    phone_number: cleanString(metadata.phone_number),
  }
  const missing = PROGRESSIVE_PROFILE_FIELDS.filter((field) => !values[field])
  const completedAt = cleanString(metadata.progressive_profile_completed_at) || null
  const dismissedAt = cleanString(metadata.progressive_profile_dismissed_at) || null
  const complete = missing.length === 0
  const dismissed = Boolean(dismissedAt)

  return {
    values,
    missing,
    complete,
    dismissed,
    shouldPrompt: !complete && !dismissed,
    completedAt,
    dismissedAt,
  }
}
