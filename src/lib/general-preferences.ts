import { Status } from "@prisma/client";
import { motionIsOff } from "@/lib/motion-mode";
import { getSettingsState, subscribeSettings, updateSettings } from "@/lib/settings-store";
import { settingsSchema } from "@/lib/backup-settings-schema";

export const DEFAULT_BOARD_KEY = "defaultBoard";
export const MOTION_KEY = "motion";
export const STARTUP_PAGE_KEY = "startupPage";
export const STALE_THRESHOLD_KEY = "staleApplicationThreshold";
export const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
export type StartupPage = (typeof STARTUP_PAGES)[number];
export const STALE_THRESHOLDS = [7, 15, 30] as const;
export type StaleApplicationThreshold = (typeof STALE_THRESHOLDS)[number];
export const DEFAULT_BOARD_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW, Status.OFFER, Status.REJECTED] as const;
export type DefaultBoardStatus = (typeof DEFAULT_BOARD_STATUSES)[number];

export function getDefaultBoard() { return getSettingsState().settings.defaultBoard; }
export function getMotionMode() { return getSettingsState().settings.motion; }
export function getStartupPage() { return getSettingsState().settings.startupPage; }
export function getStaleApplicationThreshold() { return getSettingsState().settings.staleApplicationThreshold; }
export function motionIsCurrentlyOff() { return motionIsOff(getMotionMode(), window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
export function setPreference(key: string, value: string) {
  const changes = settingsSchema.partial().parse(key === STALE_THRESHOLD_KEY ? { staleApplicationThreshold: Number(value) } : { [key]: value });
  return updateSettings(changes).catch((error) => window.alert(error.message));
}
export const subscribeToPreferences = subscribeSettings;
