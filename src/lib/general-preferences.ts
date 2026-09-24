import { Status } from "@prisma/client";

export const DEFAULT_BOARD_KEY = "nook-default-board";
export const MOTION_KEY = "nook-motion";
export const PREFERENCE_CHANGE_EVENT = "nook-general-preference-change";

export const DEFAULT_BOARD_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW, Status.OFFER, Status.REJECTED] as const;
export type DefaultBoardStatus = (typeof DEFAULT_BOARD_STATUSES)[number];

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getDefaultBoard(): DefaultBoardStatus {
  const stored = readPreference(DEFAULT_BOARD_KEY);
  return DEFAULT_BOARD_STATUSES.find((status) => status === stored) ?? Status.APPLIED;
}

export function getMotionMode(): "system" | "reduced" {
  return readPreference(MOTION_KEY) === "reduced" ? "reduced" : "system";
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
