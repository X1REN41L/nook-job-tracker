"use client";

import { useEffect, type ReactNode } from "react";
import { z } from "zod";
import { useSettings, SettingsInitialStateContext } from "@/hooks/use-settings";
import { applyTheme } from "@/lib/apply-theme";
import { getSettingsState, initializeSettings, refreshSettings, type SettingsState } from "@/lib/settings-store";

// Zod probes `new Function` to pick its JIT parser, which the CSP reports as a violation even though Zod catches it.
if (typeof window !== "undefined") z.config({ jitless: true });

export function ThemeProvider({ children, initialState }: { children: ReactNode; initialState: SettingsState }) {
  if (typeof window !== "undefined") initializeSettings(initialState);
  return <SettingsInitialStateContext.Provider value={initialState}><ThemeEffects>{children}</ThemeEffects></SettingsInitialStateContext.Provider>;
}

function ThemeEffects({ children }: { children: ReactNode }) {
  const { theme } = useSettings();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void refreshSettings().catch(() => {}); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const currentTheme = getSettingsState().settings.theme;
      applyTheme(currentTheme, media.matches);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return children;
}
