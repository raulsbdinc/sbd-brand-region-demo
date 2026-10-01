// PASSCODE-START DECISION PLANNER (pure, framework-free, unit-tested)
// ===================================================================
// Given the server-resolved base flow (from resolvePasscodeFlow — a DIRECT
// users-by-email lookup) and the credential resolution (from
// resolveSigninCredential — case-3/4 per-email / per-brand mapping), decide:
//   - which flow the passcode challenge actually runs ("database" | "passwordless")
//   - which database connection a DATABASE challenge targets (if refined)
//   - whether ANY realm operation is permitted at all (fail-closed gate)
//
// THE RULE THAT FIXES THE LINKED-ALTERNATE DEFECT
// -----------------------------------------------
// A linked ALTERNATE email lives on the passwordless "email" connection, so
// resolvePasscodeFlow correctly returns "passwordless" for it (it holds no
// identity on any database connection). But that same address can still map to
// a per-email (case 3) / per-brand (case 4) binding via resolveSigninCredential,
// which returns `resolved`. The old route unconditionally forced
// flow = "database" on any `resolved` result — issuing an otp/challenge on a
// database connection the alternate has no identity on. That send fails, the
// failure is swallowed for anti-enumeration, and the customer never gets a code
// even though the UI says one was sent.
//
// The fix: a `resolved` binding only REFINES the connection of a challenge that
// is ALREADY a database flow. It must NEVER promote a passwordless resolution
// into a database challenge. Direct/root database emails (baseFlow "database")
// keep their database challenge; linked alternates keep the passwordless
// email-delivery path that actually reaches their inbox.
//
// Anti-enumeration is untouched: this only changes WHICH real send happens; the
// route's response shape stays identical in every branch.

export type PasscodeFlow = "database" | "passwordless"

/** Mirrors SigninRealmDecisionKind from the credential model. */
export type PasscodeStartResolutionKind =
  | "resolved"
  | "shared-default"
  | "ambiguous"
  | "unavailable"

export interface PasscodeStartPlan {
  /** The flow the challenge actually runs on. */
  flow: PasscodeFlow
  /** For a DATABASE flow refined by a case-3/4 binding, the target connection. */
  dbConnectionName?: string
  /** Whether ANY realm operation may be issued (false → fail closed, no send). */
  permitsChallenge: boolean
}

export interface PlanPasscodeStartParams {
  /** From resolvePasscodeFlow (direct users-by-email lookup). */
  baseFlow: PasscodeFlow
  /** From resolveSigninCredential. */
  resolutionKind: PasscodeStartResolutionKind
  /** The resolved tenant connection name when resolutionKind === "resolved". */
  resolvedConnectionName?: string
}

/**
 * Whether a resolution permits ANY realm operation. Only a positively resolved
 * non-shared credential or the ordinary shared-default attempt do; `ambiguous`
 * and `unavailable` fail closed with NO send.
 *
 * Kept in lockstep with signinResolutionPermitsRealmOperation in the credential
 * model — duplicated here so this planner stays pure and free of server-only
 * imports.
 */
function permits(kind: PasscodeStartResolutionKind): boolean {
  // Model 4 only: "shared-default" (no bound credential) never permits a send.
  return kind === "resolved"
}

export function planPasscodeStart({
  baseFlow,
  resolutionKind,
  resolvedConnectionName,
  brandScoped = false,
}: PlanPasscodeStartParams & {
  /**
   * EU (FR/DE): a passcode may only sign in to a password this storefront's
   * brand already holds. There is no legacy shared exception. A passwordless
   * code would otherwise open an account with no enrollment in this brand.
   */
  brandScoped?: boolean
}): PasscodeStartPlan {
  if (brandScoped) {
    if (resolutionKind === "resolved" && resolvedConnectionName) {
      return { flow: "database", dbConnectionName: resolvedConnectionName, permitsChallenge: true }
    }
    return { flow: baseFlow, dbConnectionName: undefined, permitsChallenge: false }
  }
  const permitsChallenge = permits(resolutionKind)

  // A per-email / per-brand binding only REFINES an already-database challenge.
  // It never promotes a passwordless resolution to a database one — that is the
  // defect that stranded linked alternates without a code.
  const dbConnectionName =
    baseFlow === "database" &&
    resolutionKind === "resolved" &&
    resolvedConnectionName
      ? resolvedConnectionName
      : undefined

  return { flow: baseFlow, dbConnectionName, permitsChallenge }
}
