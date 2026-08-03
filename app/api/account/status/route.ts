import { NextResponse } from "next/server"
import { isAuthConfigured } from "@/lib/auth0"
import { isManagementConfigured } from "@/lib/auth0-management"

// GET /api/account/status
// Tells the client whether the live Management API surface is available, so the
// account center can decide between live data and the Demo simulation BEFORE it
// fires any per-section requests. No session required — it only reports config.
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    authConfigured: isAuthConfigured(),
    managementConfigured: isManagementConfigured(),
    hardDeleteEnabled: process.env.AUTH0_ALLOW_HARD_DELETE === "1",
  })
}
