import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Inter, Archivo, Open_Sans } from 'next/font/google'
import './globals.css'
import { AppProviders } from '@/components/app-providers'
import { AppShell } from '@/components/app-shell'
import { isAuthConfigured } from '@/lib/auth0'

// Body font for both brands.
const inter = Inter({ variable: '--font-inter', subsets: ['latin'] })
// DeWalt's display face is Archivo Expanded. We load Archivo as a variable font
// including the width (wdth) axis; the drawer applies font-stretch: 125% via the
// --brand-display-stretch token to reach the "Expanded" cut.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  axes: ['wdth'],
})
// Stanley's display face is Open Sans Condensed Bold. We load Open Sans as a
// variable font including the width (wdth) axis; the drawer applies
// font-stretch: 75% via the --brand-display-stretch token to reach the
// "Condensed" cut — the same technique used for DeWalt's Archivo Expanded (125%).
const openSans = Open_Sans({
  variable: '--font-open-sans',
  subsets: ['latin'],
  axes: ['wdth'],
})
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')

const siteName = 'SBD Sign-In Experience'
const siteDescription =
  'A consumer-grade showcase of Stanley Black & Decker customer sign-in pathways, multi-region identity architecture, and authentication journeys.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteName,
    template: `%s · ${siteName}`,
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: [
    'Stanley Black & Decker',
    'SBD',
    'sign-in',
    'authentication',
    'Auth0',
    'Okta',
    'identity architecture',
    'multi-region tenant',
    'data residency',
  ],
  generator: 'v0.app',
  openGraph: {
    type: 'website',
    siteName,
    title: siteName,
    description: siteDescription,
    url: siteUrl,
    images: [
      {
        url: '/og-default.png',
        width: 1200,
        height: 630,
        alt: 'SBD Sign-In Experience',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteName,
    description: siteDescription,
    images: ['/og-default.png'],
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${archivo.variable} ${openSans.variable} ${geistMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <AppProviders authConfigured={isAuthConfigured()}>
          <AppShell>{children}</AppShell>
        </AppProviders>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
