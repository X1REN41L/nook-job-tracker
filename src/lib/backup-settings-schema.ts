import { z } from "zod";

import { Status } from "@prisma/client";
import { MOTION_MODES } from "@/lib/motion-mode";

const DEFAULT_BOARD_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW, Status.OFFER, Status.REJECTED] as const;
const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
const STALE_THRESHOLDS = [7, 15, 30] as const;
const BOARD_STATUSES = DEFAULT_BOARD_STATUSES;
const BOARD_COLORS = ["gold", "sage", "forest", "clay", "rose", "neutral-dim"] as const;

const boardSchema = z.object({
  status: z.enum(BOARD_STATUSES),
  color: z.enum(BOARD_COLORS),
  label: z.string().min(1).max(80).refine((value) => value.trim().length > 0),
  emptyText: z.string().min(1).max(240).refine((value) => value.trim().length > 0),
}).strict();

const boardsSchema = z.array(boardSchema).superRefine((boards, context) => {
  if (boards.length === 0) return;
  if (boards.length !== BOARD_STATUSES.length || new Set(boards.map((board) => board.status)).size !== BOARD_STATUSES.length) {
    context.addIssue({ code: "custom", message: "Boards must contain each status exactly once" });
  }
});

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  defaultBoard: z.enum(DEFAULT_BOARD_STATUSES),
  startupPage: z.enum(STARTUP_PAGES),
  staleApplicationThreshold: z.union(STALE_THRESHOLDS.map((days) => z.literal(days))),
  motion: z.enum(MOTION_MODES),
  boards: boardsSchema,
  sidebarCollapsed: z.boolean(),
  archivedExpanded: z.boolean(),
  allApplicationsExpanded: z.boolean(),
}).strict();

export type BackupSettings = z.input<typeof settingsSchema>;
export type ParsedBackupSettings = z.output<typeof settingsSchema>;
