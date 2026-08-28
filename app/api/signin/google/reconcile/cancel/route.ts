import { NextResponse, type NextRequest } from "next/server"
import { journeyCookieName } from "@/lib/journey-handoff"
import { readJourneyToken } from "@/lib/journey-handoff"
import {
  SESSION_COOKIE_NAME,
  deleteStandaloneGoogleDuplicate,
} from "@/lib/google-link-core"
import type { GoogleReconcileHandoff } from "../route"

// GET /api/signin/google/reconcile/cancel
// =======================================
// The visitor DECLINED to prove ownership of the existing account. Per the
// chosen posture, we keep NO duplicate: end the standalone Google session and
// best-effort remove the standalone Google record so it can never be operated,
// then return to the home page. Nothing is ever linked on this path.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const GOOGLE_LINK_PURPOSE = "google-link" as const

export async function GET(request: NextRequest) {
  // Prefer the Google sub from the signed handoff (authoritative); it is the
  // record we're allowed to remove.
  const handoff = readJourneyToken<GoogleReconcileHandoff>(
    GOOGLE_LINK_PURPOSE,
    request.cookies.get(journeyCookieName(GOOGLE_LINK_PURPOSE))?.value,
  )
  if (handoff.ok) {
    await deleteStandaloneGoogleDuplicate(handoff.data.googleSub)
  }

  const res = NextResponse.redirect(new URL("/", request.url))
  // Clear the proof handoff and EVERY session cookie chunk.
  res.cookies.set(journeyCookieName(GOOGLE_LINK_PURPOSE), "", { path: "/", maxAge: 0 })
  for (const c of request.cookies.getAll()) {
    if (c.name === SESSION_COOKIE_NAME || c.name.startsWith(SESSION_COOKIE_NAME)) {
      res.cookies.set(c.name, "", { path: "/", maxAge: 0 })
    }
  }
  return res
}
