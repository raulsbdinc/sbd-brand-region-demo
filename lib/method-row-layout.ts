// Pure layout decisions for the "How you sign in" method rows.
//
// The right-hand slot of a method row holds EITHER an action button OR a plain
// non-action text status. Action buttons must never wrap or be squeezed, so
// they keep `shrink-0`. A non-action text status (e.g. "Managed in Brand
// passwords above") must be allowed to shrink and wrap — otherwise it forces
// the row to its max-content width and creates horizontal overflow on narrow
// screens (GLSCM-4834: Stanley UK Model 4 at 390px).
//
// This is framework-free so it can be unit-tested without a DOM.

/**
 * Tailwind classes for the method-row right-slot wrapper.
 * - `rightWrap` false (an action button): stay `shrink-0` so the button never
 *   wraps or shrinks.
 * - `rightWrap` true (a text status): `min-w-0 shrink text-right` so the text
 *   can shrink below its content width and wrap onto multiple lines instead of
 *   overflowing the row.
 */
export function methodRowRightSlotClass(rightWrap: boolean): string {
  return rightWrap ? "min-w-0 shrink text-right" : "shrink-0"
}

/**
 * Whether a password-credential row's right slot is a non-action text status
 * that must be allowed to wrap. It is a wrapping status when the row points up
 * to the Brand passwords section (`suppressChange`) or when the credential has
 * no change action at all (`hasChangeTarget` false → "Managed with your
 * account"). A row that renders a real Change action returns false so the
 * button keeps `shrink-0`.
 */
export function passwordRowRightIsWrappingStatus({
  suppressChange,
  hasChangeTarget,
}: {
  suppressChange: boolean
  hasChangeTarget: boolean
}): boolean {
  return suppressChange || !hasChangeTarget
}
