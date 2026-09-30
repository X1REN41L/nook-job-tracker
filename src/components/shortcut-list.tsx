import { shortcutLabels, shortcutSections, type ShortcutKeys } from "@/lib/keyboard-shortcuts";

export function ShortcutList({ className = "", isMac }: { className?: string; isMac: boolean }) {
  const shortcuts = shortcutLabels(isMac);
  return (
    <div className={className}>
      {shortcutSections.map((section, index) => (
        <section aria-label={section} className={index > 0 ? "mt-6 border-t border-line pt-5" : ""} key={section}>
          <h3 className="font-serif text-lg font-semibold leading-tight">{section}</h3>
          <ul className="mt-3 divide-y divide-line">
            {shortcuts.filter((shortcut) => shortcut.section === section).map(({ id, action, keys, text }) => (
              <li className="flex items-center justify-between gap-3 py-2.5 text-sm" key={id}>
                <span className="min-w-0 whitespace-nowrap">{action}</span>
                <ShortcutKeycaps keys={keys} label={text} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Each key as its own keycap, with "then" between the steps of a sequence and "or" between
 * alternatives. `inverted` suits a highlighted row; `small` sits beside a command.
 */
export function ShortcutKeycaps({ keys, label, inverted = false, size = "regular" }: { keys: ShortcutKeys; label: string; inverted?: boolean; size?: "regular" | "small" }) {
  const connectorClass = `px-0.5 text-xs ${inverted ? "text-cream/80" : "text-ink-soft"}`;
  const capClass = `inline-flex items-center justify-center rounded-nook-sm border border-b-2 font-sans font-medium leading-none ${size === "small" ? "h-5 min-w-5 px-1 text-[11px]" : "h-6 min-w-6 px-1.5 text-xs"} ${inverted ? "border-cream/40 bg-transparent text-cream" : "border-line bg-cream text-ink-soft"}`;
  return (
    <kbd className="flex shrink-0 items-center gap-1 font-sans">
      <span className="sr-only">{label}</span>
      {keys.bindings.map((binding, bindingIndex) => (
        <span className="contents" key={bindingIndex}>
          {bindingIndex > 0 && keys.between === "or" && <span aria-hidden="true" className={connectorClass}>or</span>}
          {binding.map((key, keyIndex) => (
            <span className="contents" key={keyIndex}>
              {keyIndex > 0 && keys.within === "then" && <span aria-hidden="true" className={connectorClass}>then</span>}
              <kbd aria-hidden="true" className={capClass}>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </kbd>
  );
}
