export const MOTION_MODES = ["system", "on", "off"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

export function motionIsOff(mode: MotionMode, systemPrefersReduced: boolean): boolean {
  return mode === "off" || (mode === "system" && systemPrefersReduced);
}
