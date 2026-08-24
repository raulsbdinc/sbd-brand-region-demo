export type IdentityUseCaseId =
  | "baseline"
  | "multiple-identities"
  | "per-email-password"
  | "per-brand-password"

export type IdentityUseCase = {
  id: IdentityUseCaseId
  label: string
  title: string
  status: "live" | "separate-topology"
  summary: string
  credentials: string
  topology: string
  tradeoff: string
  steps: string[]
}

/**
 * The four models agreed in the 19 August CIAM standup. This is deliberately a
 * product-decision model, not a runtime authentication switch: Models 3 and 4
 * need isolated database connections and linked test users before they can be
 * authenticated against Auth0 without changing the live shared-account demo.
 */
export const IDENTITY_USE_CASES: IdentityUseCase[] = [
  {
    id: "baseline",
    label: "1. Shared account",
    title: "One email, one password, one EU account",
    status: "live",
    summary:
      "A customer creates an account once and uses the same email and password on DeWalt France, DeWalt Germany, and Stanley France.",
    credentials: "One database identity and one password.",
    topology: "All three applications use the shared sbd-eu database connection.",
    tradeoff:
      "Lowest lifecycle and support cost. Password reset and change apply across the EU tenant.",
    steps: [
      "Create or sign in on the first EU storefront.",
      "Move to another storefront; its separate domain asks for a fresh sign-in.",
      "Enter the same email and password.",
      "Return to the same Auth0 subject and show cross-brand recognition after the second site.",
    ],
  },
  {
    id: "multiple-identities",
    label: "2. Linked identities",
    title: "More ways in, still one password",
    status: "live",
    summary:
      "A primary email, verified alternate email addresses, and Google can all reach the same customer profile.",
    credentials:
      "The database password stays with the primary account; alternate email and Google are linked sign-in identities.",
    topology:
      "The primary sbd-eu identity is linked to verified passwordless-email and Google identities.",
    tradeoff:
      "Adds recovery and social-login choice without changing the single-account model. Linking must prove ownership and reject an identity already in use.",
    steps: [
      "Add and verify an alternate email from the profile.",
      "Use that alternate email with the account password or an email passcode.",
      "Connect Google while already signed in; the session returns to the original account.",
      "Refuse an attempt to link the same Google identity to another account.",
    ],
  },
  {
    id: "per-email-password",
    label: "3. Per-email passwords",
    title: "One customer, independent email credentials",
    status: "separate-topology",
    summary:
      "Each email has its own password, but a successful sign-in resolves to one customer profile.",
    credentials: "Each independently passworded email is a distinct database identity.",
    topology:
      "A dedicated database connection for the secondary credential, explicitly linked to the primary identity after both credentials are proven.",
    tradeoff:
      "Requires connection-aware routing, secure linking, password-reset ownership, recovery rules, and orphan handling. It cannot be implemented as another field on sbd-eu.",
    steps: [
      "Authenticate the primary database account.",
      "Authenticate the alternate email against its dedicated database connection.",
      "Link the authenticated identities, preserving the chosen primary subject.",
      "Route later sign-ins by email to the matching realm and restore the primary session.",
    ],
  },
  {
    id: "per-brand-password",
    label: "4. Per-brand passwords",
    title: "One email, a separate credential for each brand",
    status: "separate-topology",
    summary:
      "The same email can have a separate password and lifecycle on each brand, with a unified profile only where those identities are linked.",
    credentials: "One database identity and password for each brand login boundary.",
    topology:
      "Separate DeWalt France, DeWalt Germany, and Stanley France database connections; their identities are explicitly linked to a primary account.",
    tradeoff:
      "Strongest brand separation, but it reintroduces account merging, per-connection recovery, duplicate prevention, reporting, and commercial-counting validation.",
    steps: [
      "Route each storefront to its assigned database connection.",
      "Authenticate the email with that brand's password.",
      "Link the verified brand identity to the chosen primary account.",
      "Make profile, recovery, Google linking, signup, and reporting connection-aware.",
    ],
  },
]

export function identityUseCaseById(id: IdentityUseCaseId): IdentityUseCase {
  return IDENTITY_USE_CASES.find((useCase) => useCase.id === id) ?? IDENTITY_USE_CASES[0]
}
