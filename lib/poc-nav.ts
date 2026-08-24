// Shared navigation config for the POC pages. Used by the header POC menu and
// the footer so they stay in sync. These are the non-storefront pages that
// explain and demonstrate the prototype.

export interface PocNavLink {
  href: string
  label: string
}

export interface PocNavGroup {
  label: string
  links: PocNavLink[]
}

export const POC_NAV_GROUPS: PocNavGroup[] = [
  {
    label: "Sign-in methods",
    links: [
      { href: "/identity-models", label: "Identity model decision" },
      { href: "/register", label: "Registration journeys" },
      { href: "/journeys", label: "Compare methods" },
      { href: "/pathways", label: "Choose a method" },
      { href: "/live", label: "Try it live" },
    ],
  },
  {
    label: "Reference",
    links: [
      { href: "/changelog", label: "Changelog" },
    ],
  },
]
