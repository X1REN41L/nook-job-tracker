"use client";

import { useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";

export function MotionPreference() {
  const mode = useSettings().motion;

  useEffect(() => {
    document.documentElement.dataset.motion = mode;
    return () => { delete document.documentElement.dataset.motion; };
  }, [mode]);

  return null;
}
