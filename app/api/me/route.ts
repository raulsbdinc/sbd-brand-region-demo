import { NextResponse } from "next/server"
import { auth0, isAuthConfigured } from "@/lib/auth0"

// Lightweight "who am I" endpoint for the REAL Auth0 session. The site header
// (a client component) only tracks the client-side mock session, so after a
// promoted real login (social / password) it had no way to know the user was
// signed in. This bridges that gap with just the display fields the header and
// account dropdown need — no token decoding.
export const dynamic = "force-dynamic"

export async function GET() {
  if (!isAuthConfigured()) {
    return NextResponse.json({ user: null })
  }

  let session: Awaited<ReturnType<typeof auth0.getSession>> = null
  try {
    session = await auth0.getSession()
  } catch {
    session = null
  }

  if (!session?.user) {
    return NextResponse.json({ user: null, claims: null })
  }

  const u = session.user
  return NextResponse.json({
    user: {
      name:
        (u.name as string | undefined) ??
        (u.nickname as string | undefined) ??
        (u.email as string | undefined) ??
        "Signed-in user",
      email: (u.email as string | undefined) ?? null,
      picture: (u.picture as string | undefined) ?? null,
    },
    // Full ID-token claims, used by the /account resolver as a reliable
    // second-chance session read (route handlers read the session cookie
    // consistently, even if a Server Component read transiently misses).
    claims: u,
  })
}
