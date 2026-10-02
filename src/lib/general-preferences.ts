import { cssTimeToMs, motionIsOff } from "@/lib/motion-mode";
import { getSettingsState } from "@/lib/settings-store";

export function getMotionMode() { return getSettingsState().settings.motion; }
/** A motion duration token from the root stylesheet, such as `--motion-exit`, in milliseconds. */
export function motionDurationMs(token: string, fallback: number) {
  return cssTimeToMs(getComputedStyle(document.documentElement).getPropertyValue(token), fallback);
}
export function motionIsCurrentlyOff() { return motionIsOff(getMotionMode(), window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
