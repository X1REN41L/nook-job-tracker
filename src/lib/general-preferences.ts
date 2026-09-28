import { motionIsOff } from "@/lib/motion-mode";
import { getSettingsState } from "@/lib/settings-store";
import { STATUS_VALUES } from "@/lib/status-values";

export const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
export type StartupPage = (typeof STARTUP_PAGES)[number];
export const STALE_THRESHOLDS = [7, 15, 30] as const;
export type StaleApplicationThreshold = (typeof STALE_THRESHOLDS)[number];
export const DEFAULT_BOARD_STATUSES = STATUS_VALUES;
export type DefaultBoardStatus = (typeof DEFAULT_BOARD_STATUSES)[number];

export function getDefaultBoard() { return getSettingsState().settings.defaultBoard; }
export function getMotionMode() { return getSettingsState().settings.motion; }
export function motionIsCurrentlyOff() { return motionIsOff(getMotionMode(), window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
