import { getBoards, normalizeBoards, saveBoards } from "@/lib/board-preferences";
import { settingsSchema, type BackupSettings, type ParsedBackupSettings } from "@/lib/backup-settings-schema";
import { DEFAULT_BOARD_KEY, MOTION_KEY, getDefaultBoard, getMotionMode, setPreference } from "@/lib/general-preferences";

export const SIDEBAR_STORAGE_KEY = "nook-sidebar-collapsed";
export const SIDEBAR_CHANGE_EVENT = "nook-sidebar-change";
export const ARCHIVED_STORAGE_KEY = "nook-archived-expanded";
export const ARCHIVED_CHANGE_EVENT = "nook-archived-change";
export const ALL_APPLICATIONS_STORAGE_KEY = "nook-all-applications-expanded";
export const ALL_APPLICATIONS_CHANGE_EVENT = "nook-all-applications-change";

export function parseBackupSettings(value: unknown): ParsedBackupSettings | null {
  const result = settingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function readBackupSettings(theme: string | undefined): ParsedBackupSettings {
  return {
    theme: theme === "light" || theme === "dark" ? theme : "system",
    defaultBoard: getDefaultBoard(),
    motion: getMotionMode(),
    boards: getBoards(),
    sidebarCollapsed: localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
    archivedExpanded: localStorage.getItem(ARCHIVED_STORAGE_KEY) === "true",
    allApplicationsExpanded: localStorage.getItem(ALL_APPLICATIONS_STORAGE_KEY) !== "false",
  };
}

export function applyBackupSettings(settings: BackupSettings, setTheme: (theme: string) => void) {
  setTheme(settings.theme);
  setPreference(DEFAULT_BOARD_KEY, settings.defaultBoard);
  setPreference(MOTION_KEY, settings.motion);
  saveBoards(normalizeBoards(settings.boards));
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(settings.sidebarCollapsed));
  localStorage.setItem(ARCHIVED_STORAGE_KEY, String(settings.archivedExpanded));
  localStorage.setItem(ALL_APPLICATIONS_STORAGE_KEY, String(settings.allApplicationsExpanded ?? true));
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
  window.dispatchEvent(new Event(ARCHIVED_CHANGE_EVENT));
  window.dispatchEvent(new Event(ALL_APPLICATIONS_CHANGE_EVENT));
}
