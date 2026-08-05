import { NextResponse } from "next/server"
import {
  requireAccountUser,
  managementErrorResponse,
} from "@/lib/account-guard"
import { getUser, updateUser } from "@/lib/auth0-management"
import {
  sanitizePhone,
  sanitizePhones,
  enforceSinglePhoneDefault,
  type Phone,
} from "@/lib/metadata-schema"

// /api/account/phones
//   GET    → the signed-in user's saved phone numbers, read from `user_metadata`
//            and normalized (invalid rows dropped, one default).
//   POST   → add a new number. The server assigns the id.
//   PATCH  → update one existing number by id.
//   DELETE → remove one number by id.
//
// Numbers are stored as an account IDENTIFIER under `user_metadata.phones`.
// Text-message sign-in / verification is a separate, staged capability that
// switches on when an SMS provider is connected to the tenant — storing and
// managing the number (this route) is already complete.
//
// Every handler is scoped to the signed-in user's own `sub` (via
// requireAccountUser) and writes the FULL phones array back through updateUser
// with { user_metadata: { phones } }. Auth0 shallow-merges top-level
// user_metadata keys, so writing `phones` never disturbs the addresses,
// preferences or consent stored alongside it.
export const dynamic = "force-dynamic"

/** Read the current, sanitized phones for a user. */
async function readPhones(sub: string): Promise<Phone[]> {
  const user = await getUser(sub)
  return sanitizePhones(
    (user.user_metadata as Record<string, unknown> | undefined)?.phones,
  )
}

/** Persist a full phones array and echo back the normalized result. */
async function writePhones(sub: string, phones: Phone[]): Promise<Phone[]> {
  const normalized = enforceSinglePhoneDefault(phones)
  const user = await updateUser(sub, { user_metadata: { phones: normalized } })
  return sanitizePhones(
    (user.user_metadata as Record<string, unknown> | undefined)?.phones,
  )
}

/** Clear the default flag on every phone except the kept id. */
function clearOtherDefaults(phones: Phone[], keepId: string): Phone[] {
  return phones.map((p) =>
    p.id !== keepId && p.is_default ? { ...p, is_default: false } : p,
  )
}

export async function GET() {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

  try {
    const phones = await readPhones(guard.user.sub)
    return NextResponse.json({ configured: true, phones })
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
  // number by POSTing its id.
  const incoming = sanitizePhone({
    ...(body as Record<string, unknown>),
    id: undefined,
  })
  if (!incoming) {
    return NextResponse.json(
      {
        error:
          "Enter the number in full international format, starting with + and your country code.",
      },
      { status: 400 },
    )
  }

  try {
    let phones = await readPhones(guard.user.sub)
    if (phones.some((p) => p.e164 === incoming.e164)) {
      return NextResponse.json(
        { error: "That number is already saved." },
        { status: 409 },
      )
    }
    // First number saved becomes the default automatically.
    if (phones.length === 0) incoming.is_default = true
    if (incoming.is_default) phones = clearOtherDefaults(phones, incoming.id)
    phones = [...phones, incoming]
    const saved = await writePhones(guard.user.sub, phones)
    return NextResponse.json({ configured: true, phones: saved })
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
    return NextResponse.json({ error: "Missing phone id." }, { status: 400 })
  }

  try {
    let phones = await readPhones(guard.user.sub)
    const index = phones.findIndex((p) => p.id === id)
    if (index < 0) {
      return NextResponse.json(
        { error: "That number no longer exists." },
        { status: 404 },
      )
    }

    // Merge incoming fields over the stored row, then re-sanitize. The id is
    // pinned so an edit can't move it to a different record.
    const merged = sanitizePhone({ ...phones[index], ...body, id })
    if (!merged) {
      return NextResponse.json(
        {
          error:
            "Enter the number in full international format, starting with + and your country code.",
        },
        { status: 400 },
      )
    }
    // A number can't be changed to duplicate another saved number.
    if (phones.some((p) => p.id !== id && p.e164 === merged.e164)) {
      return NextResponse.json(
        { error: "That number is already saved." },
        { status: 409 },
      )
    }
    phones[index] = merged
    if (merged.is_default) phones = clearOtherDefaults(phones, merged.id)
    const saved = await writePhones(guard.user.sub, phones)
    return NextResponse.json({ configured: true, phones: saved })
  } catch (err) {
    return managementErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAccountUser()
  if (!guard.ok) return guard.response

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
    return NextResponse.json({ error: "Missing phone id." }, { status: 400 })
  }

  try {
    const phones = await readPhones(guard.user.sub)
    const removed = phones.find((p) => p.id === id)
    let next = phones.filter((p) => p.id !== id)
    if (next.length === phones.length) {
      return NextResponse.json(
        { error: "That number no longer exists." },
        { status: 404 },
      )
    }
    // If we removed the default, promote the first remaining number so the list
    // always has exactly one default.
    if (removed?.is_default && next.length > 0 && !next.some((p) => p.is_default)) {
      next = next.map((p, i) => (i === 0 ? { ...p, is_default: true } : p))
    }
    const saved = await writePhones(guard.user.sub, next)
    return NextResponse.json({ configured: true, phones: saved })
  } catch (err) {
    return managementErrorResponse(err)
  }
}
