import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";

export function applyTheme(theme: ParsedBackupSettings["theme"], prefersDark: boolean) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark));
}
