// Zod-free so client preference modules can share these values without loading the settings schema.
// Every page, in sidebar order; any of them can be where Nook opens.
export const STARTUP_PAGES = ["dashboard", "job-board", "table", "interviews"] as const;
export type StartupPage = (typeof STARTUP_PAGES)[number];
export const STARTUP_PAGE_LABELS: Record<StartupPage, string> = { dashboard: "Dashboard", "job-board": "Job Board", table: "Table", interviews: "Interviews" };
export const STARTUP_PAGE_PATHS: Record<StartupPage, string> = { dashboard: "/dashboard", "job-board": "/jobs", table: "/table", interviews: "/interviews" };
export const STALE_THRESHOLDS = [7, 15, 30] as const;
// "system" follows the browser's locale; the others force a 12- or 24-hour clock.
export const TIME_FORMATS = ["system", "12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
