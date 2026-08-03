import type { Metadata } from 'next'
import { standardTenantCount, totalMarkets } from '@/lib/regions'

const title = 'Multi-Region Tenant Architecture'
const description = `Okta-recommended identity topology for Stanley Black & Decker: ${standardTenantCount()} active tenants plus China, grouped privacy-first then by proximity across ${totalMarkets()} markets where SBD has a legal entity.`

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    type: 'article',
    title,
    description,
    url: '/architecture',
    images: [
      {
        url: '/og-architecture.png',
        width: 1200,
        height: 630,
        alt: 'SBD multi-region tenant architecture diagram',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og-architecture.png'],
  },
}

export default function ArchitectureLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
