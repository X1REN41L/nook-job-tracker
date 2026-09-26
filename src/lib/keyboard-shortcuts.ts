export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

type ShortcutBinding =
  | { kind: "key"; key: string }
  | { kind: "combo"; code: string; primary?: boolean; shift?: boolean; alt?: boolean }
  | { kind: "sequence"; keys: readonly [string, string] };

export const shortcutSections = ["General", "Page Navigation", "Dashboard", "Job Board", "Interviews"] as const;
export type ShortcutSection = (typeof shortcutSections)[number];
export type ShortcutPage = "job-board" | "dashboard" | "interviews";

type ShortcutDefinition = {
  id: string;
  action: string;
  bindings: readonly ShortcutBinding[];
  section: ShortcutSection;
  page?: ShortcutPage;
  destination?: string;
};

export const shortcutDefinitions = [
  { id: "open-settings", action: "Open Settings", bindings: [{ kind: "combo", code: "Comma", primary: true, shift: true }], section: "General" },
  { id: "show-shortcuts", action: "Keyboard Shortcuts", bindings: [{ kind: "key", key: "?" }], section: "General" },
  { id: "toggle-sidebar", action: "Toggle Sidebar", bindings: [{ kind: "combo", code: "KeyS", primary: true, shift: true }], section: "General" },
  { id: "close", action: "Close / Cancel", bindings: [{ kind: "key", key: "Escape" }], section: "General" },
  { id: "undo", action: "Undo latest action", bindings: [{ kind: "key", key: "u" }], section: "General" },
  { id: "go-dashboard", action: "Dashboard", bindings: [{ kind: "sequence", keys: ["g", "d"] }], section: "Page Navigation", destination: "/dashboard" },
  { id: "go-job-board", action: "Job Board", bindings: [{ kind: "sequence", keys: ["g", "j"] }], section: "Page Navigation", destination: "/jobs" },
  { id: "go-interviews", action: "Interviews", bindings: [{ kind: "sequence", keys: ["g", "i"] }], section: "Page Navigation", destination: "/interviews" },
  { id: "go-overview", action: "Overview", bindings: [{ kind: "sequence", keys: ["g", "o"] }], section: "Dashboard", page: "dashboard", destination: "/dashboard" },
  { id: "go-analytics", action: "Analytics", bindings: [{ kind: "sequence", keys: ["g", "a"] }], section: "Dashboard", page: "dashboard", destination: "/dashboard/analytics" },
  { id: "go-stale", action: "Stale Applications", bindings: [{ kind: "sequence", keys: ["g", "s"] }], section: "Dashboard", page: "dashboard", destination: "/dashboard/stale" },
  { id: "new-job", action: "New Job", bindings: [{ kind: "combo", code: "KeyN", alt: true }], section: "Job Board", page: "job-board" },
  { id: "search-job-board", action: "Search", bindings: [{ kind: "key", key: "/" }], section: "Job Board", page: "job-board" },
  { id: "archive-focused", action: "Archive focused card", bindings: [{ kind: "combo", code: "KeyA", alt: true }], section: "Job Board", page: "job-board" },
  { id: "delete-focused", action: "Delete focused card", bindings: [{ kind: "key", key: "Delete" }, { kind: "key", key: "Backspace" }], section: "Job Board", page: "job-board" },
  { id: "focus-application-up", action: "Previous application", bindings: [{ kind: "key", key: "ArrowUp" }], section: "Job Board", page: "job-board" },
  { id: "focus-application-down", action: "Next application", bindings: [{ kind: "key", key: "ArrowDown" }], section: "Job Board", page: "job-board" },
  { id: "focus-column-left", action: "Previous column", bindings: [{ kind: "key", key: "ArrowLeft" }], section: "Job Board", page: "job-board" },
  { id: "focus-column-right", action: "Next column", bindings: [{ kind: "key", key: "ArrowRight" }], section: "Job Board", page: "job-board" },
  { id: "search-interviews", action: "Search", bindings: [{ kind: "key", key: "/" }], section: "Interviews", page: "interviews" },
  { id: "switch-interview-tabs", action: "Switch tabs", bindings: [{ kind: "key", key: "ArrowLeft" }, { kind: "key", key: "ArrowRight" }], section: "Interviews", page: "interviews" },
] as const satisfies readonly ShortcutDefinition[];

export type DashboardShortcut = (typeof shortcutDefinitions)[number]["id"];

function matchesBinding(binding: ShortcutBinding, event: KeyboardEvent, isMac: boolean, pendingPrefix: string | null) {
  if (binding.kind === "sequence") {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
      pendingPrefix === binding.keys[0] && event.key.toLowerCase() === binding.keys[1];
  }
  if (binding.kind === "combo") {
    return event.code === binding.code && event.metaKey === (isMac && !!binding.primary) &&
      event.ctrlKey === (!isMac && !!binding.primary) && event.altKey === !!binding.alt && event.shiftKey === !!binding.shift;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || (event.shiftKey && binding.key !== "?")) return false;
  return binding.key.length === 1 ? event.key.toLowerCase() === binding.key.toLowerCase() : event.key === binding.key;
}

function activeOnPage(definition: ShortcutDefinition, page: ShortcutPage) {
  return !definition.page || definition.page === page;
}

export function startsShortcutSequence(event: KeyboardEvent, page: ShortcutPage) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditableShortcutTarget(event.target)) return false;
  return shortcutDefinitions.some((definition) => activeOnPage(definition, page) &&
    definition.bindings.some((binding) => binding.kind === "sequence" && binding.keys[0] === event.key.toLowerCase()));
}

export function matchDashboardShortcut(event: KeyboardEvent, isMac: boolean, page: ShortcutPage, pendingPrefix: string | null = null): DashboardShortcut | null {
  if (isEditableShortcutTarget(event.target) && event.key !== "Escape") return null;
  return shortcutDefinitions.find((definition) => activeOnPage(definition, page) &&
    definition.bindings.some((binding) => matchesBinding(binding, event, isMac, pendingPrefix)))?.id ?? null;
}

export function shortcutDestination(id: DashboardShortcut) {
  for (const definition of shortcutDefinitions) {
    if (definition.id === id && "destination" in definition) return definition.destination;
  }
  return undefined;
}

function bindingLabel(binding: ShortcutBinding, isMac: boolean) {
  if (binding.kind === "sequence") return binding.keys.join(" ").toUpperCase();
  if (binding.kind === "key") {
    const symbols: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" };
    return symbols[binding.key] ?? (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  }
  const key = binding.code === "Comma" ? "," : binding.code.startsWith("Key") ? binding.code.slice(3) : binding.code;
  const modifiers = [binding.primary && (isMac ? "⌘" : "Ctrl"), binding.shift && (isMac ? "⇧" : "Shift"), binding.alt && (isMac ? "⌥" : "Alt")].filter(Boolean);
  return isMac ? [...modifiers, key].join(" ") : [...modifiers, key].join(" + ");
}

export function shortcutLabels(isMac: boolean) {
  return shortcutDefinitions.map((definition) => ({
    id: definition.id,
    action: definition.action,
    keys: definition.bindings.map((binding) => bindingLabel(binding, isMac)).join(" / "),
    section: definition.section,
  }));
}
