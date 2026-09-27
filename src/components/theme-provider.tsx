"use client";

import { useEffect, type ReactNode } from "react";
import { getSettingsState, refreshSettings, setSettingsState, updateSettings, useSettings, type SettingsState } from "@/lib/settings-store";

export function useTheme() {
  const { theme } = useSettings();
  return { theme, setTheme: (value: string) => {
    if (value === "light" || value === "dark" || value === "system") {
      void updateSettings({ theme: value }).catch((error) => window.alert(error.message));
    }
  } };
}

export function ThemeProvider({ children, initialState }: { children: ReactNode; initialState: SettingsState }) {
  const { theme } = useSettings();
  useEffect(() => {
    setSettingsState(initialState);
    const refresh = () => { if (document.visibilityState === "visible") void refreshSettings().catch(() => {}); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [initialState]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const currentTheme = getSettingsState().settings.theme;
      document.documentElement.classList.toggle("dark", currentTheme === "dark" || (currentTheme === "system" && media.matches));
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return children;
}
