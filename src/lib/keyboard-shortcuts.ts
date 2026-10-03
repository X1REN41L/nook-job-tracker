import type { ApplicationPageName } from "@/types/navigation";

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

type ShortcutBinding =
  | { kind: "key"; key: string }
  // `primary` is ⌘ on a Mac and Ctrl elsewhere; `control` is the Control key on every platform.
  | { kind: "combo"; code: string; primary?: boolean; control?: boolean; shift?: boolean; alt?: boolean }
  | { kind: "sequence"; keys: readonly [string, string] };

export const shortcutSections = ["General", "Go to", "Job Board", "Interviews"] as const;
type ShortcutSection = (typeof shortcutSections)[number];

type ShortcutDefinition = {
  id: string;
  action: string;
  bindings: readonly ShortcutBinding[];
  section: ShortcutSection;
  page?: ApplicationPageName;
  destination?: string;
  /** Bindings that are two halves of one move (↑ ↓) rather than alternatives. */
  paired?: boolean;
  /** Listed for discovery only: the focused control or open panel handles the key itself. */
  handledInPlace?: boolean;
};

export const shortcutDefinitions = [
  { id: "command-palette", action: "Command palette", bindings: [{ kind: "combo", code: "KeyK", primary: true }], section: "General" },
  { id: "search", action: "Search this page", bindings: [{ kind: "key", key: "/" }], section: "General" },
  { id: "new-job", action: "New job", bindings: [{ kind: "key", key: "n" }], section: "General" },
  { id: "edit-details", action: "Edit open application", bindings: [{ kind: "key", key: "e" }], section: "General", handledInPlace: true },
  // Ctrl+Z on every platform, a Mac included.
  { id: "undo", action: "Undo", bindings: [{ kind: "combo", code: "KeyZ", control: true }], section: "General" },
  { id: "close", action: "Close", bindings: [{ kind: "key", key: "Escape" }], section: "General" },
  // Ctrl+/ on every platform, a Mac included, like Undo.
  { id: "toggle-sidebar", action: "Toggle sidebar", bindings: [{ kind: "combo", code: "Slash", control: true }], section: "General" },
  { id: "open-settings", action: "Settings", bindings: [{ kind: "combo", code: "Comma", primary: true, shift: true }], section: "General" },
  { id: "show-shortcuts", action: "Keyboard shortcuts", bindings: [{ kind: "key", key: "?" }], section: "General" },
  { id: "go-dashboard", action: "Dashboard", bindings: [{ kind: "sequence", keys: ["g", "d"] }], section: "Go to", destination: "/dashboard" },
  { id: "go-analytics", action: "Analytics", bindings: [{ kind: "sequence", keys: ["g", "a"] }], section: "Go to", destination: "/dashboard/analytics" },
  { id: "go-job-board", action: "Job Board", bindings: [{ kind: "sequence", keys: ["g", "j"] }], section: "Go to", destination: "/jobs" },
  { id: "go-table", action: "Table", bindings: [{ kind: "sequence", keys: ["g", "t"] }], section: "Go to", destination: "/table" },
  { id: "go-interviews", action: "Interviews", bindings: [{ kind: "sequence", keys: ["g", "i"] }], section: "Go to", destination: "/interviews" },
  { id: "move-focus", action: "Move between cards", bindings: [{ kind: "key", key: "ArrowUp" }, { kind: "key", key: "ArrowDown" }, { kind: "key", key: "ArrowLeft" }, { kind: "key", key: "ArrowRight" }], section: "Job Board", page: "job-board", paired: true },
  { id: "open-card", action: "Open card", bindings: [{ kind: "key", key: "Enter" }], section: "Job Board", page: "job-board", handledInPlace: true },
  // While a card is picked up, the arrows move it between columns.
  { id: "pick-up-card", action: "Pick up or drop card", bindings: [{ kind: "key", key: " " }], section: "Job Board", page: "job-board", handledInPlace: true },
  { id: "archive-focused", action: "Archive card", bindings: [{ kind: "key", key: "e" }], section: "Job Board", page: "job-board" },
  { id: "delete-focused", action: "Delete card", bindings: [{ kind: "key", key: "Delete" }, { kind: "key", key: "Backspace" }], section: "Job Board", page: "job-board" },
  { id: "switch-interview-tab", action: "Upcoming / Past", bindings: [{ kind: "key", key: "ArrowLeft" }, { kind: "key", key: "ArrowRight" }], section: "Interviews", page: "interviews", paired: true },
] as const satisfies readonly ShortcutDefinition[];

export type DashboardShortcut = (typeof shortcutDefinitions)[number]["id"];

function matchesBinding(binding: ShortcutBinding, event: KeyboardEvent, isMac: boolean, pendingPrefix: string | null) {
  if (binding.kind === "sequence") {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey &&
      pendingPrefix === binding.keys[0] && event.key.toLowerCase() === binding.keys[1];
  }
  if (binding.kind === "combo") {
    return event.code === binding.code && event.metaKey === (isMac && !!binding.primary) &&
      event.ctrlKey === (!!binding.control || (!isMac && !!binding.primary)) && event.altKey === !!binding.alt && event.shiftKey === !!binding.shift;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  // Shift is part of typing symbols such as ? (and / on some layouts), but a shifted letter is not a shortcut.
  if (event.shiftKey && (binding.key.length > 1 || /[a-z]/i.test(binding.key))) return false;
  return binding.key.length === 1 ? event.key.toLowerCase() === binding.key : event.key === binding.key;
}

function activeOnPage(definition: ShortcutDefinition, page: ApplicationPageName) {
  return !("handledInPlace" in definition) && (!definition.page || definition.page === page);
}

export function startsShortcutSequence(event: KeyboardEvent, page: ApplicationPageName) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditableShortcutTarget(event.target)) return false;
  return shortcutDefinitions.some((definition) => activeOnPage(definition, page) &&
    definition.bindings.some((binding) => binding.kind === "sequence" && binding.keys[0] === event.key.toLowerCase()));
}

export function matchDashboardShortcut(event: KeyboardEvent, isMac: boolean, page: ApplicationPageName, pendingPrefix: string | null = null): DashboardShortcut | null {
  if (isEditableShortcutTarget(event.target) && event.key !== "Escape") return null;
  // A pending G only completes a sequence, so G then E never archives.
  const definitions = pendingPrefix ? shortcutDefinitions.filter((definition) => definition.bindings.some((binding) => binding.kind === "sequence")) : shortcutDefinitions;
  return definitions.find((definition) => activeOnPage(definition, page) &&
    definition.bindings.some((binding) => matchesBinding(binding, event, isMac, pendingPrefix)))?.id ?? null;
}

export function shortcutDestination(id: DashboardShortcut) {
  for (const definition of shortcutDefinitions) {
    if (definition.id === id && "destination" in definition) return definition.destination;
  }
  return undefined;
}

/** The keycaps for one binding, such as ["⌘", "K"] or ["G", "D"]. */
function bindingKeys(binding: ShortcutBinding, isMac: boolean): string[] {
  if (binding.kind === "sequence") return binding.keys.map((key) => key.toUpperCase());
  if (binding.kind === "key") {
    const symbols: Record<string, string> = { " ": "Space", Enter: isMac ? "↩" : "Enter", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Delete: "Del", Backspace: isMac ? "⌫" : "Backspace" };
    return [symbols[binding.key] ?? binding.key.toUpperCase()];
  }
  const key = ({ Comma: ",", Slash: "/" } as Record<string, string>)[binding.code] ?? binding.code.replace(/^Key/, "");
  const modifiers = [binding.control && (isMac ? "⌃" : "Ctrl"), binding.primary && (isMac ? "⌘" : "Ctrl"), binding.shift && (isMac ? "⇧" : "Shift"), binding.alt && (isMac ? "⌥" : "Alt")].filter((modifier) => typeof modifier === "string");
  return [...modifiers, key];
}

export type ShortcutKeys = {
  /** Each alternative binding, as its keycaps. */
  bindings: string[][];
  /** How the keycaps within a binding read: pressed together, or one then the other. */
  within: "together" | "then";
  /** How the bindings read: either one, or parts of one move (↑ ↓). */
  between: "or" | "pair";
};

function definitionKeys(definition: ShortcutDefinition, isMac: boolean): ShortcutKeys {
  return {
    bindings: definition.bindings.map((binding) => bindingKeys(binding, isMac)),
    within: definition.bindings[0]?.kind === "sequence" ? "then" : "together",
    between: definition.paired ? "pair" : "or",
  };
}

/** Plain-text keys, such as "⌘K", "Ctrl+K" or "G then D", for screen readers and tests. */
function keysText({ bindings, within, between }: ShortcutKeys, isMac: boolean) {
  return bindings.map((keys) => keys.join(within === "then" ? " then " : isMac ? "" : "+")).join(between === "or" ? " or " : " ");
}

export function shortcutLabels(isMac: boolean) {
  return shortcutDefinitions.map((definition) => {
    const keys = definitionKeys(definition, isMac);
    return { id: definition.id, action: definition.action, keys, text: keysText(keys, isMac), section: definition.section };
  });
}

/** One shortcut's keys, for showing beside a command. */
export function shortcutKeys(id: DashboardShortcut, isMac: boolean) {
  const definition: ShortcutDefinition | undefined = shortcutDefinitions.find((candidate) => candidate.id === id);
  if (!definition) return null;
  const keys = definitionKeys(definition, isMac);
  return { keys, text: keysText(keys, isMac) };
}
