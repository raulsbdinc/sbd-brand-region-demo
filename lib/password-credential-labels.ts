// PASSWORD-CREDENTIAL LABELS — PURE, CUSTOMER-FACING
// ==================================================
// Turns one password credential into the customer-facing name + explanation
// shown on /profile. Framework-free so the labelling rules are unit-testable
// without React. NO internal vocabulary ("case 3/4", "per-email", connection
// names, Auth0, bindings) is ever produced here.
//
// CRITICAL: a brand credential names its OWN brand, derived from the row's own
// `brand`/`connectionKey` — never the deployment brand. An account can hold BOTH
// a DeWalt and a Stanley credential at once, so on a DeWalt deployment the
// Stanley row must still say "Stanley".

export interface PasswordCredentialView {
  connectionKey?: "shared" | "per-email" | "dewalt" | "stanley"
  brand?: string
  email?: string
}

const BRAND_DISPLAY_NAMES: Record<string, string> = {
  dewalt: "DeWalt",
  stanley: "Stanley",
}

/** Customer display name for a brand id; a safe fallback for anything unknown. */
export function brandDisplay(brand?: string): string {
  return (brand && BRAND_DISPLAY_NAMES[brand]) || "this brand"
}

/** The display brand for ONE credential row, from its own brand/connectionKey. */
export function rowBrandName(m: PasswordCredentialView): string {
  return brandDisplay(m.brand ?? m.connectionKey)
}

/** Customer label for one password credential — never an internal key/label. */
export function passwordCredentialLabel(m: PasswordCredentialView): string {
  if (m.connectionKey === "per-email") return `Password for ${m.email ?? "an email"}`
  if (m.connectionKey === "dewalt" || m.connectionKey === "stanley") {
    return `${rowBrandName(m)} password`
  }
  return "Account password"
}

/** Plain-English explanation of where a credential works. */
export function passwordCredentialLine(m: PasswordCredentialView): string {
  if (m.connectionKey === "per-email") {
    return `${m.email ?? "This email"} has its own password, separate from your account password.`
  }
  if (m.connectionKey === "dewalt" || m.connectionKey === "stanley") {
    return `Works only on ${rowBrandName(m)} sites. Your account password still works on other SBD brands.`
  }
  return "Works with your verified account emails across DeWalt and Stanley sites."
}

// ADD-PASSWORD DISPLAY STATE
// ==========================
// Decides whether the /profile "Add password" area should present the ADD
// trigger (at least one outcome is still available) or a concise COMPLETED-state
// row (both outcomes already set up). Keeping this pure means we never render an
// "Add password" dialog whose only choices are disabled.

/** The minimal availability shape this helper reads — structural, decoupled. */
export interface AddPasswordAvailabilityView {
  anotherEmail: { available: boolean }
  thisBrand: { available: boolean }
  /** Concrete deployment brand id (e.g. "dewalt" / "stanley"). */
  deploymentBrand?: string
}

export type AddPasswordDisplayState =
  | { kind: "add"; deploymentBrandName: string }
  | { kind: "complete"; message: string }

/** Shown when every add-password outcome is already set up. */
export const ADD_PASSWORD_COMPLETE_MESSAGE = "All available passwords are already set up."

/**
 * Decide the Add-password area's display state. When NOTHING can be added, we
 * return the completed state (no dialog with only-disabled choices). Otherwise
 * we return the add state with the deployment brand resolved CONCRETELY — this
 * always names DeWalt/Stanley and never the vague "this brand" fallback, even
 * when the this-brand option itself is unavailable because it already exists.
 */
export function addPasswordDisplayState(
  a: AddPasswordAvailabilityView,
): AddPasswordDisplayState {
  const anythingAvailable = a.anotherEmail.available || a.thisBrand.available
  if (!anythingAvailable) {
    return { kind: "complete", message: ADD_PASSWORD_COMPLETE_MESSAGE }
  }
  return { kind: "add", deploymentBrandName: brandDisplay(a.deploymentBrand) }
}
