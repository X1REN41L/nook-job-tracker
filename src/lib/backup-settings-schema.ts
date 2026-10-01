import { z } from "zod";

import { MOTION_MODES } from "@/lib/motion-mode";
import { STALE_THRESHOLDS, STARTUP_PAGES, TIME_FORMATS, WEEK_STARTS } from "@/lib/settings-values";
import { STATUS_VALUES } from "@/lib/status-values";

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  defaultBoard: z.enum(STATUS_VALUES),
  startupPage: z.enum(STARTUP_PAGES),
  staleApplicationThreshold: z.union(STALE_THRESHOLDS.map((days) => z.literal(days))),
  motion: z.enum(MOTION_MODES),
  timeFormat: z.enum(TIME_FORMATS),
  weekStart: z.enum(WEEK_STARTS),
  sidebarCollapsed: z.boolean(),
  archivedExpanded: z.boolean(),
}).strict();

export type ParsedBackupSettings = z.output<typeof settingsSchema>;
