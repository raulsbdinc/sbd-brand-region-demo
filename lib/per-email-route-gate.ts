import { NextResponse } from "next/server"
import { SITE_MARKET } from "@/lib/site"
import {
  PER_EMAIL_UNAVAILABLE_MESSAGE,
  perEmailAccountsEnabled,
} from "@/lib/uk-feature-flags"

/**
 * Server-side boundary for every "password for each email" endpoint. While the
 * UK per-email flag is off (the default) these endpoints refuse BEFORE reading
 * the body or touching Auth0, so hiding the UI is never the only guard.
 */
export function perEmailRouteGate(): NextResponse | null {
  if (perEmailAccountsEnabled(SITE_MARKET)) return null
  return NextResponse.json(
    { error: PER_EMAIL_UNAVAILABLE_MESSAGE, reason: "per-email-disabled" },
    { status: 404 },
  )
}
