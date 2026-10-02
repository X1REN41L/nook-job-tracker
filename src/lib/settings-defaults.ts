import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";

export const defaultSettings: ParsedBackupSettings = {
  theme: "system", startupPage: "dashboard", staleApplicationThreshold: 15,
  motion: "system", timeFormat: "system", weekStart: "system", sidebarCollapsed: false, archivedExpanded: false,
};
