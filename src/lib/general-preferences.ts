import { Status } from "@prisma/client";
import { motionIsOff } from "@/lib/motion-mode";
import { getSettingsState } from "@/lib/settings-store";

export const STARTUP_PAGES = ["dashboard", "job-board", "interviews"] as const;
export type StartupPage = (typeof STARTUP_PAGES)[number];
export const STALE_THRESHOLDS = [7, 15, 30] as const;
export type StaleApplicationThreshold = (typeof STALE_THRESHOLDS)[number];
export const DEFAULT_BOARD_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW, Status.OFFER, Status.REJECTED] as const;
export type DefaultBoardStatus = (typeof DEFAULT_BOARD_STATUSES)[number];

export function getDefaultBoard() { return getSettingsState().settings.defaultBoard; }
export function getMotionMode() { return getSettingsState().settings.motion; }
export function motionIsCurrentlyOff() { return motionIsOff(getMotionMode(), window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
