"use client";

import { useEffect, useState } from "react";

import { motionDurationMs } from "@/lib/general-preferences";

/**
 * True while a view is opening, so its `.motion-reveal` elements rise in once;
 * elements shown later (by searching or filtering) appear at once. Changing
 * `viewKey` (for example a tab) opens the view again. `lastDelayMs` is the
 * longest reveal delay, so the window lasts until the last element settles.
 */
export function useOpeningReveal(viewKey: unknown, lastDelayMs: number) {
  const [settledKey, setSettledKey] = useState<{ key: unknown } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKey({ key: viewKey }), lastDelayMs + motionDurationMs("--motion-chart", 560));
    return () => window.clearTimeout(timer);
  }, [viewKey, lastDelayMs]);

  return settledKey === null || settledKey.key !== viewKey;
}
