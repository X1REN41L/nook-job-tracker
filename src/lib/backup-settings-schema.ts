import { z } from "zod";

import { DEFAULT_BOARD_STATUSES } from "@/lib/general-preferences";

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  defaultBoard: z.enum(DEFAULT_BOARD_STATUSES),
  motion: z.enum(["system", "reduced"]),
  boards: z.array(z.unknown()),
  sidebarCollapsed: z.boolean(),
  archivedExpanded: z.boolean(),
});

export type BackupSettings = z.infer<typeof settingsSchema>;
