import type { NextConfig } from "next"

// Verification builds use a separate distDir so they never corrupt the
// running dev server. Dev keeps .next; `npm run build` writes .next-build.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    serverActions: {
      // Garage capture posts photographs and short clips straight off a phone.
      // The default ceiling is 1MB, which a single iPhone photo already
      // exceeds, so the flow failed on its first real submit. A handful of
      // stills plus a clip is tens of megabytes. This app runs on one laptop
      // over a LAN, so a generous ceiling costs memory during the upload and
      // nothing else.
      bodySizeLimit: "200mb",
    },
  },
}

export default nextConfig
