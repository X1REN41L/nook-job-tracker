import { settingsSchema, type ParsedBackupSettings } from "@/lib/backup-settings-schema";

export const defaultSettings: ParsedBackupSettings = settingsSchema.parse({
  theme: "system", defaultBoard: "APPLIED", startupPage: "dashboard", staleApplicationThreshold: 15,
  motion: "system", boards: [], sidebarCollapsed: false, archivedExpanded: false, allApplicationsExpanded: true,
});
