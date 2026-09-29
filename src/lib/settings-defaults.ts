import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";

export const defaultSettings: ParsedBackupSettings = {
  theme: "system", defaultBoard: "APPLIED", startupPage: "dashboard", staleApplicationThreshold: 15,
  motion: "system", timeFormat: "system", sidebarCollapsed: false, archivedExpanded: false, allApplicationsExpanded: true,
};
