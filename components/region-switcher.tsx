"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ChevronsUpDown, Globe, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/toast"
import { AUTH_REGION_ORDER } from "@/lib/regions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Per-region display metadata from /api/region (name + hosting location). */
interface RegionInfo {
  id: string
  name: string
  hostingCode: string
  hostingName: string
  /** Special = handled outside the standard global footprint (China). */
  special: boolean
}
interface RegionResponse {
  active: string
  regions: RegionInfo[]
}

const regionFetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<RegionResponse>)

/** The data-residency line shown under each region. */
function residencyCaption(r: RegionInfo): string {
  if (r.special) return "Requires in-country handling (PIPL)"
  return `${r.hostingName} data residency`
}

/**
 * Region switcher — the single control in the header for choosing the visitor's
 * data-residency region. The POC is locked to the DeWalt brand, so this picks
 * only the region: selecting one writes the `sbd_region` cookie via /api/region,
 * and the proxy then routes real /auth/* sign-ins to that region's identity
 * tenant. To a visitor these look like genuinely separate regional sites; the
 * underlying Auth0 wiring is an implementation detail.
 */
export function RegionSwitcher() {
  const router = useRouter()
  const { toast } = useToast()
  const { data, mutate } = useSWR("/api/region", regionFetcher, {
    revalidateOnFocus: false,
  })
  const [pending, setPending] = useState<string | null>(null)

  // Only the broad regions are selectable (per-country app overrides are not
  // surfaced in the simplified POC switcher).
  const regions = (data?.regions ?? []).filter((r) =>
    AUTH_REGION_ORDER.includes(r.id),
  )
  const active = data?.active ?? ""
  const activeRegion = regions.find((r) => r.id === active)

  async function selectRegion(id: string) {
    if (!data || id === active) return
    setPending(id)
    try {
      const res = await fetch("/api/region", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ region: id }),
      }).catch(() => null)
      if (!res || !res.ok) {
        toast({
          title: "Couldn't switch region",
          variant: "destructive",
          description: "Please try again.",
        })
        return
      }
      // Update the SWR cache so the control reflects the new selection
      // immediately. router.refresh() only re-runs server components — without
      // this the radio value would snap back to the previous region.
      await mutate({ ...data, active: id }, { revalidate: true })
      // Refresh server components so the proxy routes to the new tenant.
      router.refresh()
      const r = regions.find((x) => x.id === id)
      if (r) {
        toast({
          title: `Region set to ${r.name}`,
          variant: "success",
          description: (
            <>
              Sign-ins now route to the{" "}
              <span className="font-medium text-foreground">{r.name}</span>{" "}
              identity tenant — {residencyCaption(r)}.
            </>
          ),
        })
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-ink-foreground)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--brand-ink-foreground)] outline-none transition-colors hover:bg-[var(--brand-ink-foreground)]/10 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        title="Switch data-residency region"
      >
        <Globe className="size-4 shrink-0 opacity-80" aria-hidden="true" />
        <span className="hidden max-w-[10rem] truncate sm:inline">
          {activeRegion?.name ?? "Select region"}
        </span>
        {activeRegion ? (
          <span
            className="flex h-5 items-center justify-center rounded-sm bg-[var(--brand)] px-1.5 text-[10px] font-bold tabular-nums text-[var(--brand-foreground)]"
            aria-hidden="true"
          >
            {activeRegion.hostingCode}
          </span>
        ) : null}
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        <span className="sr-only">
          {activeRegion
            ? `Current data-residency region: ${activeRegion.name}, ${residencyCaption(activeRegion)}. Open to switch.`
            : "Open to select a data-residency region."}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Data-residency region
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup value={active} onValueChange={selectRegion}>
          {regions.map((r) => (
            <DropdownMenuRadioItem key={r.id} value={r.id} className="items-start gap-2">
              <span className="mt-0.5 flex h-5 shrink-0 items-center justify-center rounded-sm bg-muted px-1.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                {r.hostingCode}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{r.name}</span>
                  {pending === r.id ? (
                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {residencyCaption(r)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
