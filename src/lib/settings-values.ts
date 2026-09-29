// Zod-free so client preference modules can share these values without loading the settings schema.
export const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
export const STALE_THRESHOLDS = [7, 15, 30] as const;
export const BOARD_COLORS = ["gold", "sage", "forest", "teal", "clay", "rose", "neutral-dim"] as const;
