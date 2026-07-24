import type { NextConfig } from "next"

// Verification builds use a separate distDir so they never corrupt the
// running dev server. Dev keeps .next; `npm run build` writes .next-build.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
}

export default nextConfig
