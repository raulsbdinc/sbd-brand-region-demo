// The POC is locked to a single brand: DeWalt. The brand model is kept (as a
// one-entry set) so the theme tokens, wordmark, and metadata preference still
// resolve through one code path — but there is no brand switching.
export type BrandId = "dewalt"

export type CountryId = "us" | "uk" | "ca" | "fr" | "de" | "au"

export type MethodId =
  | "passkey"
  | "magic-link"
  | "email-code"
  | "password"
  | "social"
  | "sso"
  | "qr"

export type SocialProvider =
  | "Google"
  | "Apple"
  | "Microsoft"
  | "Facebook"
  | "GitHub"
  | "LinkedIn"
  | "X"

export interface SignInMetrics {
  /** Measured time from flow start to signed-in, in milliseconds. */
  timeMs: number
  /** Number of taps / clicks the tester made to complete the flow. */
  taps: number
}

export interface DecodedToken {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  /** A representative encoded string, for display only. */
  encoded: string
}

export interface SessionTokens {
  idToken: DecodedToken
  accessToken: DecodedToken
}

export interface Session {
  name: string
  email: string
  method: MethodId
  provider?: SocialProvider | "Entra ID"
  avatarUrl?: string
  roles: string[]
  muid: string
  metrics: SignInMetrics
  tokens: SessionTokens
  signedInAt: number
}
