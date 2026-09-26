import { Status } from "@prisma/client";
import { MOTION_MODES, motionIsOff, type MotionMode } from "@/lib/motion-mode";

export const DEFAULT_BOARD_KEY = "nook-default-board";
export const MOTION_KEY = "nook-motion";
export const STARTUP_PAGE_KEY = "nook-startup-page";
export const STALE_THRESHOLD_KEY = "nook-stale-threshold";
export const PREFERENCE_CHANGE_EVENT = "nook-general-preference-change";
export const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
export type StartupPage = (typeof STARTUP_PAGES)[number];
export const STALE_THRESHOLDS = [7, 15, 30] as const;
export type StaleApplicationThreshold = (typeof STALE_THRESHOLDS)[number];

export const DEFAULT_BOARD_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW, Status.OFFER, Status.REJECTED] as const;
export type DefaultBoardStatus = (typeof DEFAULT_BOARD_STATUSES)[number];

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getDefaultBoard(): DefaultBoardStatus {
  const stored = readPreference(DEFAULT_BOARD_KEY);
  return DEFAULT_BOARD_STATUSES.find((status) => status === stored) ?? Status.APPLIED;
}

export function getMotionMode(): MotionMode {
  const stored = readPreference(MOTION_KEY);
  // Preserve the current browser's choice until the one-time localStorage update runs.
  if (stored === "reduced") return "off";
  return MOTION_MODES.find((mode) => mode === stored) ?? "system";
}

export function migrateLegacyMotionPreference() {
  try {
    if (localStorage.getItem(MOTION_KEY) === "reduced") localStorage.setItem(MOTION_KEY, "off");
  } catch {
    // The effective mode still resolves to Off if storage is unavailable.
  }
}

export function motionIsCurrentlyOff(): boolean {
  return motionIsOff(getMotionMode(), window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function getStartupPage(): StartupPage {
  const stored = readPreference(STARTUP_PAGE_KEY);
  return STARTUP_PAGES.find((page) => page === stored) ?? "dashboard";
}

export function getStaleApplicationThreshold(): StaleApplicationThreshold {
  const stored = Number(readPreference(STALE_THRESHOLD_KEY));
  return STALE_THRESHOLDS.find((days) => days === stored) ?? 15;
}

export function setPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
  } catch {
    // Preferences remain at their last stored value if storage is unavailable.
  }
}

export function subscribeToPreferences(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFERENCE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFERENCE_CHANGE_EVENT, onChange);
  };
}
