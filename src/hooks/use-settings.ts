import { createContext, useContext, useSyncExternalStore } from "react";

import { getSettingsState, subscribeSettings, type SettingsState } from "@/lib/settings-store";

export const SettingsInitialStateContext = createContext<SettingsState | null>(null);

export function useSettingsState() {
  const initialState = useContext(SettingsInitialStateContext);
  if (!initialState) throw new Error("Settings provider is missing");
  return useSyncExternalStore(subscribeSettings, getSettingsState, () => initialState);
}

export function useSettings() { return useSettingsState().settings; }
