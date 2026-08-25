/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // The two developer routes were renamed (welcome -> dev-quick-view,
  // account -> dev-account-details). These redirects keep a stale tab open on
  // stage from 404-ing. `permanent: false` so browsers/CDNs don't cache them.
  //
  // NOTE: a Next redirect `source` matches that EXACT path only — "/account"
  // does NOT match "/api/account/...", so the profile's own backend under
  // /api/account is unaffected.
  async redirects() {
    return [
      { source: "/welcome", destination: "/dev-quick-view", permanent: false },
      {
        source: "/account",
        destination: "/dev-account-details",
        permanent: false,
      },
    ]
  },
}

export default nextConfig
