import type { NextConfig } from "next";

import { MAX_BACKUP_FILE_BYTES } from "./src/lib/backup-limits";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.PLAYWRIGHT_NEXT_DIST_DIR ?? ".next",
  typescript: process.env.PLAYWRIGHT_NEXT_DIST_DIR ? { tsconfigPath: "tsconfig.playwright.json" } : undefined,
  experimental: {
    // Past this size Next drops the crossing chunk and truncates the body. The extra 1 MB (more than
    // one socket chunk) lets any body over the route limit still reach the route's own 413.
    proxyClientMaxBodySize: MAX_BACKUP_FILE_BYTES + 1024 * 1024,
  },
};

export default nextConfig;
