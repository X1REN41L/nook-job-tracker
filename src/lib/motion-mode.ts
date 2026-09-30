export const MOTION_MODES = ["system", "on", "off"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

export function motionIsOff(mode: MotionMode, systemPrefersReduced: boolean): boolean {
  return mode === "off" || (mode === "system" && systemPrefersReduced);
}

/** Milliseconds for a CSS time such as "160ms" or ".16s"; built stylesheets may write either form. */
export function cssTimeToMs(value: string, fallback: number): number {
  const time = value.trim();
  const amount = Number.parseFloat(time);
  if (!Number.isFinite(amount)) return fallback;
  return time.endsWith("ms") ? amount : time.endsWith("s") ? amount * 1000 : fallback;
}

/**
 * Inline style for a `.motion-reveal` element: elements rise in one after another
 * when a page opens. Past `limit`, later elements share the last delay so long
 * lists never keep you waiting.
 */
export function revealDelay(order: number, options?: RevealTiming): { animationDelay: string } {
  return { animationDelay: `${revealDelayMs(order, options)}ms` };
}

type RevealTiming = { base?: number; step?: number; limit?: number };

export function revealDelayMs(order: number, { base = 0, step = 60, limit = 6 }: RevealTiming = {}) {
  return base + Math.min(order, limit) * step;
}
