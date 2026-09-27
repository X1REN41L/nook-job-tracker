import { useSyncExternalStore } from "react";

import { defaultSettings } from "@/lib/settings-defaults";
import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";

export type SettingsState = { settings: ParsedBackupSettings; revision: number };
let state: SettingsState = { settings: defaultSettings, revision: 0 };
const listeners = new Set<() => void>();
let pending: Promise<void> = Promise.resolve();

export function getSettingsState() { return state; }
export function subscribeSettings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setSettingsState(next: SettingsState) {
  if (next.revision < state.revision) return;
  state = next;
  listeners.forEach((listener) => listener());
}
export function useSettings() { return useSyncExternalStore(subscribeSettings, getSettingsState, getSettingsState).settings; }

export async function refreshSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("Could not load settings");
  setSettingsState(await response.json() as SettingsState);
}

export function updateSettings(changes: Partial<ParsedBackupSettings> | ((settings: ParsedBackupSettings) => Partial<ParsedBackupSettings>)) {
  const operation = pending.then(async () => {
    const nextChanges = typeof changes === "function" ? changes(state.settings) : changes;
    const response = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: nextChanges, revision: state.revision }),
    });
    const result = await response.json();
    if (response.status === 409) {
      setSettingsState(result);
      throw new Error("Settings changed in another tab. Please try again.");
    }
    if (!response.ok) throw new Error(result.error ?? "Could not save settings");
    setSettingsState(result as SettingsState);
  });
  pending = operation.catch(() => {});
  return operation;
}
