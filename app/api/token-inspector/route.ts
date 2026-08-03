import { NextResponse } from "next/server"
import { auth0, isAuthConfigured } from "@/lib/auth0"
import { getUser, isManagementConfigured } from "@/lib/auth0-management"
import type { DecodedToken } from "@/lib/types"

// Returns the REAL Auth0 session's decoded ID and access tokens so the client
// Token inspector can display them. The mock flows populate tokens in client
// state, but promoted real flows (social, password) leave a server-side cookie
// instead — this route bridges that gap. Signatures are NOT verified; this is
// for inspection/demo only.
export const dynamic = "force-dynamic"

/** Decode a JWT's header + payload without verifying the signature. */
function decodeJwt(token: string | undefined): DecodedToken | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const decodePart = (part: string) =>
      JSON.parse(
        Buffer.from(
          part.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8"),
      ) as Record<string, unknown>
    return {
      header: decodePart(parts[0]),
      payload: decodePart(parts[1]),
      encoded: token,
    }
  } catch {
    return null
  }
}

export async function GET() {
  if (!isAuthConfigured()) {
    return NextResponse.json({ session: null })
  }

  let session: Awaited<ReturnType<typeof auth0.getSession>> = null
  try {
    session = await auth0.getSession()
  } catch {
    session = null
  }

  if (!session?.user) {
    return NextResponse.json({ session: null })
  }

  const idToken = decodeJwt(session.tokenSet?.idToken)
  const accessToken = decodeJwt(session.tokenSet?.accessToken)

  // The token only carries the claims an Auth0 Action injects. The full
  // user_metadata / app_metadata records live in the directory and are only
  // reachable via the Management API — fetch them (scoped to THIS user's sub,
  // never a client-supplied id) when it's configured. Failures degrade to
  // null so the token view still renders.
  let userMetadata: Record<string, unknown> | null = null
  let appMetadata: Record<string, unknown> | null = null
  let metadataSource: "directory" | null = null
  let metadataError: string | null = null

  const sub = session.user.sub as string | undefined
  if (sub && isManagementConfigured()) {
    try {
      const record = await getUser(sub)
      userMetadata = record.user_metadata ?? {}
      appMetadata = record.app_metadata ?? {}
      metadataSource = "directory"
    } catch (err) {
      metadataError =
        err instanceof Error ? err.message : "Failed to load directory metadata"
      console.log("[v0] token-inspector metadata fetch error:", metadataError)
    }
  }

  return NextResponse.json({
    session: {
      email:
        (session.user.email as string | undefined) ??
        (session.user.name as string | undefined) ??
        "signed-in user",
      idToken,
      accessToken,
      userMetadata,
      appMetadata,
      metadataSource,
      metadataError,
    },
  })
}
