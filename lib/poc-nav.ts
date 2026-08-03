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
    label: "Evaluate",
    links: [
      { href: "/evaluation", label: "CIAM Evaluation" },
      { href: "/operations", label: "CIAM Operations" },
      { href: "/architecture", label: "Architecture" },
    ],
  },
  {
    label: "Sign-in methods",
    links: [
      { href: "/register", label: "Registration journeys" },
      { href: "/journeys", label: "Compare methods" },
      { href: "/pathways", label: "Choose a method" },
      { href: "/live", label: "Try it live" },
    ],
  },
  {
    label: "Reference",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
]
