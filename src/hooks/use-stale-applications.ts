"use client";

import { useEffect, useState } from "react";

import { useSettings } from "@/hooks/use-settings";
import { currentBrowserTimeZone } from "@/lib/application-date";
import type { StaleApplicationsData } from "@/types/dashboard";

/** Loads stale applications for the current calendar date and threshold; `data` is null while loading or disabled. */
export function useStaleApplications(today: string, refreshKey: unknown, enabled = true) {
  const staleApplicationThreshold = useSettings().staleApplicationThreshold;
  const [result, setResult] = useState<{ today: string; threshold: number; data: StaleApplicationsData } | null>(null);
  const [failedToday, setFailedToday] = useState<string | null>(null);

  useEffect(() => {
    if (!today || !enabled) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ today, timeZone: currentBrowserTimeZone(), staleApplicationThreshold: String(staleApplicationThreshold) });
    fetch(`/api/dashboard/stale?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Stale applications request failed");
        return response.json() as Promise<StaleApplicationsData>;
      })
      .then((data) => {
        setResult({ today, threshold: staleApplicationThreshold, data });
        setFailedToday(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load stale applications", reason);
        setFailedToday(today);
      });
    return () => controller.abort();
  }, [today, refreshKey, staleApplicationThreshold, enabled]);

  const data = enabled && result?.today === today && result.threshold === staleApplicationThreshold ? result.data : null;
  return { data, error: enabled && failedToday === today };
}
