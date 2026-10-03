import type { NextConfig } from "next";

import { MAX_MUTATION_BODY_BYTES } from "./src/lib/backup-limits";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/applications/import*": ["./src/workers/backup-staging*", "./src/lib/**/*.ts", "./src/types/**/*.ts", "./node_modules/@streamparser/json/**"],
  },
  poweredByHeader: false,
  distDir: process.env.PLAYWRIGHT_NEXT_DIST_DIR ?? ".next",
  typescript: process.env.PLAYWRIGHT_NEXT_DIST_DIR ? { tsconfigPath: "tsconfig.playwright.json" } : undefined,
  headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }];
  },
  experimental: {
    // Past this size Next drops the crossing chunk and truncates the body. The extra 1 MB (more than
    // one socket chunk) lets any body over the route limit still reach the route's own 413.
    proxyClientMaxBodySize: MAX_MUTATION_BODY_BYTES + 1024 * 1024,
  },
};

export default nextConfig;
