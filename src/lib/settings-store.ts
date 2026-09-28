import { defaultSettings } from "@/lib/settings-defaults";
import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";

export type SettingsState = { settings: ParsedBackupSettings; revision: number };
type SettingsChanges = Partial<ParsedBackupSettings>;
type PendingChange = { update: (settings: ParsedBackupSettings) => SettingsChanges; changes: SettingsChanges; resolve: () => void; reject: (error: Error) => void };

let committed: SettingsState = { settings: defaultSettings, revision: 0 };
let state: SettingsState = committed;
let initialized = false;
let writing = false;
const listeners = new Set<() => void>();
const pending: PendingChange[] = [];

export function getSettingsState() { return state; }
export function subscribeSettings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function publish(next: SettingsState) {
  if (next.settings === state.settings && next.revision === state.revision) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function publishPending() {
  if (!pending.length) {
    publish(committed);
    return;
  }
  let settings = committed.settings;
  for (const change of pending) {
    change.changes = change.update(settings);
    settings = { ...settings, ...change.changes };
  }
  publish({ settings, revision: committed.revision });
}

// Called only in the client provider's render, before descendants subscribe.
export function initializeSettings(initialState: SettingsState) {
  if (initialized) return;
  initialized = true;
  committed = initialState;
  publishPending();
}

export function setSettingsState(next: SettingsState) {
  if (next.revision <= committed.revision) return;
  committed = next;
  publishPending();
}

export async function refreshSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("Could not load settings");
  setSettingsState(await response.json() as SettingsState);
}

async function flushSettings() {
  if (writing) return;
  writing = true;
  while (pending.length) {
    const change = pending[0];
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: change.changes, revision: committed.revision }),
      });
      const result = await response.json();
      if (response.status === 409) {
        committed = result as SettingsState;
        throw new Error("Settings changed in another tab. Please try again.");
      }
      if (!response.ok) throw new Error(result.error ?? "Could not save settings");
      committed = result as SettingsState;
      pending.shift();
      publishPending();
      change.resolve();
    } catch (error) {
      pending.shift();
      publishPending();
      change.reject(error instanceof Error ? error : new Error("Could not save settings"));
    }
  }
  writing = false;
}

export function updateSettings(changes: SettingsChanges | ((settings: ParsedBackupSettings) => SettingsChanges)): Promise<void> {
  const update = typeof changes === "function" ? changes : () => changes;
  const nextChanges = update(state.settings);
  if (Object.entries(nextChanges).every(([key, value]) => Object.is(state.settings[key as keyof ParsedBackupSettings], value))) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    pending.push({ update, changes: nextChanges, resolve, reject });
    publishPending();
    void flushSettings();
  });
}
