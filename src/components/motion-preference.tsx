"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getMotionMode, subscribeToPreferences } from "@/lib/general-preferences";

export function MotionPreference() {
  const mode = useSyncExternalStore(subscribeToPreferences, getMotionMode, () => "system");

  useEffect(() => {
    document.documentElement.dataset.motion = mode;
    return () => { delete document.documentElement.dataset.motion; };
  }, [mode]);

  return null;
}
