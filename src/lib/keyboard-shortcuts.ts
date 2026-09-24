export type DashboardShortcut =
  | "archive-focused"
  | "close"
  | "delete-focused"
  | "focus-search"
  | "new-job"
  | "open-settings"
  | "show-shortcuts"
  | "toggle-sidebar"
  | "undo";

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function matchDashboardShortcut(event: KeyboardEvent, isMac: boolean): DashboardShortcut | null {
  if (event.key === "Escape") return "close";
  if (isEditableShortcutTarget(event.target)) return null;

  const key = event.key.toLowerCase();
  const archiveShortcut = isMac
    ? event.code === "KeyA" && event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey
    : event.code === "KeyA" && event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey;
  if (archiveShortcut) return "archive-focused";

  const primaryModifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (primaryModifier && event.shiftKey && !event.altKey && event.code === "Comma") return "open-settings";

  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (key === "n") return "new-job";
  if (event.key === "/") return "focus-search";
  if (event.key === "?") return "show-shortcuts";
  if (key === "u") return "undo";
  if (key === "b") return "toggle-sidebar";
  if (event.key === "Delete" || event.key === "Backspace") return "delete-focused";
  return null;
}

export function shortcutLabels(isMac: boolean) {
  return [
    { action: "New Job", keys: "N" },
    { action: "Open settings", keys: isMac ? "⌘ ⇧ ," : "Ctrl + Shift + ," },
    { action: "Focus application search", keys: "/" },
    { action: "Keyboard shortcuts", keys: "?" },
    { action: "Archive focused application", keys: isMac ? "⌥ A" : "Alt + Shift + A" },
    { action: "Delete focused application", keys: "Delete / Backspace" },
    { action: "Toggle sidebar", keys: "B" },
    { action: "Undo latest change", keys: "U" },
    { action: "Close or cancel", keys: "Esc" },
  ];
}
