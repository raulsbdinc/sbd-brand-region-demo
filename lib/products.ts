import { SITE_BRAND } from "./site"
import type { BrandId } from "./types"

export interface Product {
  id: string
  /** Manufacturer model code, shown small and muted above the name. */
  model: string
  name: string
  blurb: string
  price: number
  image: string
}

// PER-BRAND CATALOGUE
// ===================
// One repo builds several single-brand storefronts (see lib/site.ts). The
// catalogue is a brand-fact table like BRANDS / BRAND_VOICE: it is keyed by
// brand id, never hardcoded to one brand, and resolved from SITE_BRAND below.
//
// Both shipping brands cover the SAME three categories on purpose — drill,
// impact driver, saw — so switching from the DeWalt site to the Stanley site
// shows an identical storefront SHAPE carrying a genuinely different catalogue
// (different models, prices, photography). Images are the brands' own
// production product photography, downloaded into public/products/<brand>/.
const BRAND_PRODUCTS: Record<BrandId, Product[]> = {
  dewalt: [
    {
      id: "drill",
      model: "DCD794NT",
      name: "18V XR Brushless Compact Drill Driver",
      blurb:
        "A compact, brushless drill driver for everyday drilling and driving, with the control to sink screws cleanly and the torque for tougher holes.",
      price: 159,
      image: "/products/dewalt/drill.webp",
    },
    {
      id: "impact-driver",
      model: "DCF860NT",
      name: "18V XR Brushless Impact Driver",
      blurb:
        "High-speed impact driver that drives long fasteners and lag screws quickly, with precision modes for controlled starts in delicate work.",
      price: 189,
      image: "/products/dewalt/impact-driver.webp",
    },
    {
      id: "saw",
      model: "DCS383H2",
      name: "18V XR Brushless Metal Circular Saw 184 mm",
      blurb:
        "A 184 mm circular saw tuned for cutting metal — steel studs, sheet and conduit — leaving cool, burr-free edges on the jobsite.",
      price: 349,
      image: "/products/dewalt/circular-saw.webp",
    },
  ],
  stanley: [
    {
      id: "drill",
      model: "SFMCD716B",
      name: "V20 Brushless Hammer Drill Driver",
      blurb:
        "A brushless hammer drill driver with a dedicated hammer mode for masonry, plus the everyday drilling and driving to handle most jobs around the site.",
      price: 119,
      image: "/products/stanley/drill.webp",
    },
    {
      id: "impact-driver",
      model: "SFMCF811B",
      name: "V20 Brushless Impact Driver 180 Nm",
      blurb:
        "A brushless impact driver delivering 180 Nm of fastening torque, for driving long screws and bolts without stalling or cam-out.",
      price: 139,
      image: "/products/stanley/impact-driver.webp",
    },
    {
      id: "saw",
      model: "SFMCS311B",
      name: "V20 Brushless Reciprocating Saw",
      blurb:
        "A brushless reciprocating saw for demolition and rough cutting through wood, plastic and metal, with tool-free blade changes to keep work moving.",
      price: 149,
      image: "/products/stanley/reciprocating-saw.webp",
    },
  ],
  // Craftsman is not a shipping storefront in this demo, but the lookup must
  // never be undefined for any BrandId. It reuses the DeWalt catalogue as a
  // safe stand-in; no Craftsman product photography exists in the repo.
  craftsman: [],
}

/**
 * Resolve the catalogue for any brand. Pure and dependency-free so every
 * combination can be reasoned about independent of the build's env. Falls back
 * to the DeWalt catalogue for any brand without its own list (Craftsman), so a
 * BrandId lookup is never undefined.
 */
export function productsForBrand(brand: BrandId): Product[] {
  const list = BRAND_PRODUCTS[brand]
  return list && list.length > 0 ? list : BRAND_PRODUCTS.dewalt
}

/** The catalogue for this deployment's fixed brand. */
export const PRODUCTS: Product[] = productsForBrand(SITE_BRAND)
