import { z } from "zod";

import { DEFAULT_BOARD_STATUSES, STALE_THRESHOLDS, STARTUP_PAGES } from "@/lib/general-preferences";
import { MOTION_MODES } from "@/lib/motion-mode";

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  defaultBoard: z.enum(DEFAULT_BOARD_STATUSES),
  startupPage: z.enum(STARTUP_PAGES),
  staleApplicationThreshold: z.union(STALE_THRESHOLDS.map((days) => z.literal(days))),
  motion: z.enum(MOTION_MODES),
  boards: z.array(z.unknown()),
  sidebarCollapsed: z.boolean(),
  archivedExpanded: z.boolean(),
  allApplicationsExpanded: z.boolean(),
}).strict();

export type BackupSettings = z.input<typeof settingsSchema>;
export type ParsedBackupSettings = z.output<typeof settingsSchema>;
