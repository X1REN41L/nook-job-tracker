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

export type ShortcutSection = "Global" | "Job Board" | "Dashboard" | "Interviews" | "Navigation";

type ShortcutDefinition = {
  id: string;
  action: string;
  bindings: readonly ShortcutBinding[];
  macBindings?: readonly ShortcutBinding[];
  pages?: readonly ("job-board" | "dashboard" | "interviews")[];
  section: ShortcutSection;
  scopeNote?: string;
  displayId?: string;
};

const shortcutDefinitions = [
  { id: "new-job", action: "New Job", bindings: [{ kind: "key", key: "n" }], section: "Job Board", scopeNote: "All pages" },
  { id: "open-settings", action: "Open settings", bindings: [{ kind: "combo", code: "Comma", primary: true, shift: true }], section: "Global" },
  { id: "focus-search", displayId: "search-job-board", action: "Search Job Board", bindings: [{ kind: "key", key: "/" }], pages: ["job-board"], section: "Job Board" },
  { id: "focus-search", displayId: "search-interviews", action: "Search Interviews", bindings: [{ kind: "key", key: "/" }], pages: ["interviews"], section: "Interviews" },
  { id: "show-shortcuts", action: "Keyboard shortcuts", bindings: [{ kind: "key", key: "?" }], section: "Global" },
  {
    id: "archive-focused",
    displayId: "archive-focused-card",
    action: "Archive focused card",
    bindings: [{ kind: "combo", code: "KeyA", alt: true, shift: true }],
    macBindings: [{ kind: "combo", code: "KeyA", alt: true }],
    pages: ["job-board"],
    section: "Job Board",
  },
  {
    id: "archive-focused",
    displayId: "archive-focused-row",
    action: "Archive focused row",
    bindings: [{ kind: "combo", code: "KeyA", alt: true, shift: true }],
    macBindings: [{ kind: "combo", code: "KeyA", alt: true }],
    pages: ["dashboard"],
    section: "Dashboard",
  },
  { id: "delete-focused", displayId: "delete-focused-card", action: "Delete focused card", bindings: [{ kind: "key", key: "Delete" }, { kind: "key", key: "Backspace" }], pages: ["job-board"], section: "Job Board" },
  { id: "delete-focused", displayId: "delete-focused-row", action: "Delete focused row", bindings: [{ kind: "key", key: "Delete" }, { kind: "key", key: "Backspace" }], pages: ["dashboard"], section: "Dashboard" },
  { id: "toggle-sidebar", action: "Toggle sidebar", bindings: [{ kind: "key", key: "b" }], section: "Global" },
  { id: "undo", action: "Undo latest status change, archive, or delete", bindings: [{ kind: "key", key: "u" }], section: "Global", scopeNote: "All pages" },
  { id: "close", action: "Close or cancel", bindings: [{ kind: "key", key: "Escape" }], section: "Global" },
  { id: "go-dashboard", action: "Go to Dashboard", bindings: [{ kind: "sequence", keys: ["g", "d"] }], section: "Navigation" },
  { id: "go-job-board", action: "Go to Job Board", bindings: [{ kind: "sequence", keys: ["g", "j"] }], section: "Navigation" },
  { id: "go-interviews", action: "Go to Interviews", bindings: [{ kind: "sequence", keys: ["g", "i"] }], section: "Navigation" },
  { id: "interview-tab-left", action: "Switch Interviews tabs", bindings: [{ kind: "key", key: "ArrowLeft" }], pages: ["interviews"], section: "Interviews", displayId: "interview-tabs" },
  { id: "interview-tab-right", action: "Switch Interviews tabs", bindings: [{ kind: "key", key: "ArrowRight" }], pages: ["interviews"], section: "Interviews", displayId: "interview-tabs" },
  { id: "focus-application-up", action: "Focus previous application", bindings: [{ kind: "key", key: "ArrowUp" }], pages: ["job-board", "dashboard"], section: "Navigation", scopeNote: "Job Board & Dashboard" },
  { id: "focus-application-down", action: "Focus next application", bindings: [{ kind: "key", key: "ArrowDown" }], pages: ["job-board", "dashboard"], section: "Navigation", scopeNote: "Job Board & Dashboard" },
  { id: "focus-column-left", action: "Focus card in previous column", bindings: [{ kind: "key", key: "ArrowLeft" }], pages: ["job-board"], section: "Navigation" },
  { id: "focus-column-right", action: "Focus card in next column", bindings: [{ kind: "key", key: "ArrowRight" }], pages: ["job-board"], section: "Navigation" },
] as const satisfies readonly ShortcutDefinition[];

export type DashboardShortcut = (typeof shortcutDefinitions)[number]["id"];

function bindingsFor(definition: ShortcutDefinition, isMac: boolean): readonly ShortcutBinding[] {
  return isMac && definition.macBindings ? definition.macBindings : definition.bindings;
}

function matchesBinding(binding: ShortcutBinding, event: KeyboardEvent, isMac: boolean, pendingPrefix: string | null) {
  if (binding.kind === "sequence") {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
      pendingPrefix === binding.keys[0] && event.key.toLowerCase() === binding.keys[1];
  }
  if (binding.kind === "combo") {
    return event.code === binding.code && event.metaKey === (isMac && !!binding.primary) &&
      event.ctrlKey === (!isMac && !!binding.primary) && event.altKey === !!binding.alt && event.shiftKey === !!binding.shift;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return binding.key.length === 1 ? event.key.toLowerCase() === binding.key.toLowerCase() : event.key === binding.key;
}

export function startsShortcutSequence(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditableShortcutTarget(event.target)) return false;
  return shortcutDefinitions.some((definition) => definition.bindings.some((binding) => binding.kind === "sequence" && binding.keys[0] === event.key.toLowerCase()));
}

export function matchDashboardShortcut(event: KeyboardEvent, isMac: boolean, page: "job-board" | "dashboard" | "interviews", pendingPrefix: string | null = null): DashboardShortcut | null {
  const close = shortcutDefinitions.find((definition) => definition.id === "close");
  if (close && bindingsFor(close, isMac).some((binding) => matchesBinding(binding, event, isMac, pendingPrefix))) return "close";
  if (isEditableShortcutTarget(event.target)) return null;
  return shortcutDefinitions.find((definition) =>
    (!("pages" in definition) || (definition.pages as readonly string[]).includes(page)) &&
    bindingsFor(definition, isMac).some((binding) => matchesBinding(binding, event, isMac, pendingPrefix)))?.id ?? null;
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
  const labels = new Map<string, { action: string; keys: string; section: ShortcutSection; scopeNote?: string }>();
  for (const definition of shortcutDefinitions) {
    const id = "displayId" in definition ? definition.displayId : definition.id;
    const keys = bindingsFor(definition, isMac).map((binding) => bindingLabel(binding, isMac)).join(" / ");
    const existing = labels.get(id);
    if (existing) existing.keys += ` / ${keys}`;
    else labels.set(id, { action: definition.action, keys, section: definition.section, scopeNote: "scopeNote" in definition ? definition.scopeNote : undefined });
  }
  return [...labels.values()];
}
