import { z } from "zod";

import { MOTION_MODES } from "@/lib/motion-mode";
import { BOARD_COLORS, STALE_THRESHOLDS, STARTUP_PAGES } from "@/lib/settings-values";
import { STATUS_VALUES } from "@/lib/status-values";

const boardSchema = z.object({
  status: z.enum(STATUS_VALUES),
  color: z.enum(BOARD_COLORS),
  label: z.string().min(1).max(80).refine((value) => value.trim().length > 0),
  emptyText: z.string().min(1).max(240).refine((value) => value.trim().length > 0),
}).strict();

const boardsSchema = z.array(boardSchema).superRefine((boards, context) => {
  if (boards.length === 0) return;
  if (boards.length !== STATUS_VALUES.length || new Set(boards.map((board) => board.status)).size !== STATUS_VALUES.length) {
    context.addIssue({ code: "custom", message: "Boards must contain each status exactly once" });
  }
});

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  defaultBoard: z.enum(STATUS_VALUES),
  startupPage: z.enum(STARTUP_PAGES),
  staleApplicationThreshold: z.union(STALE_THRESHOLDS.map((days) => z.literal(days))),
  motion: z.enum(MOTION_MODES),
  boards: boardsSchema,
  sidebarCollapsed: z.boolean(),
  archivedExpanded: z.boolean(),
  allApplicationsExpanded: z.boolean(),
}).strict();

export type ParsedBackupSettings = z.output<typeof settingsSchema>;
