import { AU, CA, DE, FR, GB, US } from "country-flag-icons/react/3x2"
import type { FlagComponent } from "country-flag-icons/react/3x2"
import type { CountryId } from "@/lib/types"
import { cn } from "@/lib/utils"

// Market flag for the header/footer country pill. Uses country-flag-icons (MIT,
// tree-shakeable SVG components) rather than emoji flags: Windows Chrome renders
// regional-indicator emoji as two letters (e.g. "FR") instead of a flag, which
// would defeat the point on the demo machine.
//
// Every CountryId in COUNTRIES is mapped here, so a future DeWalt UK or DeWalt
// US deployment picks up its flag automatically. Note the id→ISO mapping: our
// "uk" uses the ISO 3166-1 alpha-2 code GB. Only the flags actually referenced
// are imported by name, keeping the bundle tree-shaken to these six.
const FLAGS: Record<CountryId, FlagComponent> = {
  us: US,
  uk: GB,
  ca: CA,
  fr: FR,
  de: DE,
  au: AU,
}

export function CountryFlag({
  country,
  className,
}: {
  country: CountryId
  className?: string
}) {
  const Flag = FLAGS[country]
  if (!Flag) return null
  return (
    <Flag
      // The country name sits next to this as text, so the flag is decorative
      // to assistive tech.
      aria-hidden="true"
      focusable="false"
      className={cn(
        // ~16px wide, subtle rounded corners, and a hairline ring so the white
        // band of flags like France doesn't vanish against a light pill.
        "w-4 shrink-0 rounded-[2px] ring-1 ring-black/20",
        className,
      )}
    />
  )
}
