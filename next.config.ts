import type { NextConfig } from "next";

import { MAX_BACKUP_FILE_BYTES } from "./src/lib/backup-limits";

const nextConfig: NextConfig = {
  devIndicators: false,
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
      ],
    }];
  },
  experimental: {
    // Past this size Next drops the crossing chunk and truncates the body. The extra 1 MB (more than
    // one socket chunk) lets any body over the route limit still reach the route's own 413.
    proxyClientMaxBodySize: MAX_BACKUP_FILE_BYTES + 1024 * 1024,
  },
};

export default nextConfig;
