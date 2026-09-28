import { motionIsOff } from "@/lib/motion-mode";
import { getSettingsState } from "@/lib/settings-store";

export function getDefaultBoard() { return getSettingsState().settings.defaultBoard; }
export function getMotionMode() { return getSettingsState().settings.motion; }
export function motionIsCurrentlyOff() { return motionIsOff(getMotionMode(), window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
