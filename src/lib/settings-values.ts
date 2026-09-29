// Zod-free so client preference modules can share these values without loading the settings schema.
export const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
export const STALE_THRESHOLDS = [7, 15, 30] as const;
// "system" follows the browser's locale; the others force a 12- or 24-hour clock.
export const TIME_FORMATS = ["system", "12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
