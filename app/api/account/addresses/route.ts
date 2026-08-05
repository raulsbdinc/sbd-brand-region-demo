import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import {
  sanitizeAddress,
  sanitizeAddresses,
  enforceSingleDefaultPerType,
  type Address,
  type AddressType,
} from "@/lib/metadata-schema"

// /api/account/addresses
//   GET    → the signed-in user's saved addresses, read from `user_metadata`
//            and normalized (bad rows dropped, one default per type).
//   POST   → add a new address. The server assigns the id.
//   PATCH  → update one existing address by id.
//   DELETE → remove one address by id.
//
// Every handler is scoped to the signed-in user's own `sub` (via
// requireAccountUser) and writes the FULL addresses array back through
// updateUser with { user_metadata: { addresses } }. Auth0 shallow-merges
// top-level user_metadata keys, so writing `addresses` never disturbs the site
// preferences, consent, or phone number stored alongside it.
export const dynamic = "force-dynamic"

/** Read the current, sanitized addresses for a user. */
async function readAddresses(sub: string): Promise<Address[]> {
  const user = await getUser(sub)
  return sanitizeAddresses(
    (user.user_metadata as Record<string, unknown> | undefined)?.addresses,
  )
}

/** Persist a full addresses array and echo back the normalized result. */
async function writeAddresses(
  sub: string,
  addresses: Address[],
): Promise<Address[]> {
  const normalized = enforceSingleDefaultPerType(addresses)
  const user = await updateUser(sub, { user_metadata: { addresses: normalized } })
  return sanitizeAddresses(
    (user.user_metadata as Record<string, unknown> | undefined)?.addresses,
  )
}

/** Clear the default flag on every address of `type` except the kept id. */
function clearOtherDefaults(
  addresses: Address[],
  type: AddressType,
  keepId: string,
): Address[] {
  return addresses.map((a) =>
    a.type === type && a.id !== keepId && a.is_default
      ? { ...a, is_default: false }
      : a,
  )
}

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const addresses = await readAddresses(guard.user.sub)
    return NextResponse.json({ configured: true, addresses })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function POST(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Force a server-assigned id so a client can never overwrite an existing
  // address by POSTing its id.
  const incoming = sanitizeAddress({ ...(body as Record<string, unknown>), id: undefined })
  if (!incoming) {
    return NextResponse.json(
      { error: "Enter at least a recipient and a street address." },
      { status: 400 },
    )
  }

  try {
    let addresses = await readAddresses(guard.user.sub)
    // Selecting a new default clears the previous default of the same type.
    if (incoming.is_default) {
      addresses = clearOtherDefaults(addresses, incoming.type, incoming.id)
    }
    addresses = [...addresses, incoming]
    const saved = await writeAddresses(guard.user.sub, addresses)
    return NextResponse.json({ configured: true, addresses: saved })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) {
    return NextResponse.json({ error: "Missing address id." }, { status: 400 })
  }

  try {
    let addresses = await readAddresses(guard.user.sub)
    const index = addresses.findIndex((a) => a.id === id)
    if (index < 0) {
      return NextResponse.json(
        { error: "That address no longer exists." },
        { status: 404 },
      )
    }

    // Merge the incoming fields over the stored row, then re-sanitize. The id
    // is pinned so a rename of fields can't move it to a different record.
    const merged = sanitizeAddress({ ...addresses[index], ...body, id })
    if (!merged) {
      return NextResponse.json(
        { error: "Enter at least a recipient and a street address." },
        { status: 400 },
      )
    }
    addresses[index] = merged
    if (merged.is_default) {
      addresses = clearOtherDefaults(addresses, merged.type, merged.id)
    }
    const saved = await writeAddresses(guard.user.sub, addresses)
    return NextResponse.json({ configured: true, addresses: saved })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  // Accept the id from the query string or a JSON body.
  const url = new URL(request.url)
  let id = url.searchParams.get("id")?.trim() ?? ""
  if (!id) {
    try {
      const body = (await request.json()) as { id?: unknown }
      if (typeof body.id === "string") id = body.id.trim()
    } catch {
      // no body — handled by the missing-id check below
    }
  }
  if (!id) {
    return NextResponse.json({ error: "Missing address id." }, { status: 400 })
  }

  try {
    const addresses = await readAddresses(guard.user.sub)
    const next = addresses.filter((a) => a.id !== id)
    if (next.length === addresses.length) {
      return NextResponse.json(
        { error: "That address no longer exists." },
        { status: 404 },
      )
    }
    const saved = await writeAddresses(guard.user.sub, next)
    return NextResponse.json({ configured: true, addresses: saved })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
