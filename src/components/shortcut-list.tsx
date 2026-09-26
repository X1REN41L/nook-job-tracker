import { shortcutLabels, shortcutSections } from "@/lib/keyboard-shortcuts";

export function ShortcutList({ className = "", isMac }: { className?: string; isMac: boolean }) {
  const shortcuts = shortcutLabels(isMac);
  return (
    <div className={className}>
      {shortcutSections.map((section, index) => (
        <section aria-label={section} className={index > 0 ? "mt-6 border-t border-line pt-5" : ""} key={section}>
          <h3 className="font-serif text-lg font-semibold leading-tight">{section}</h3>
          <ul className="mt-3 divide-y divide-line">
            {shortcuts.filter((shortcut) => shortcut.section === section).map(({ id, action, keys }) => (
              <li className="flex items-center justify-between gap-3 py-2.5 text-sm" key={id}>
                <span className="min-w-0 whitespace-nowrap">{action}</span>
                <span className="flex w-36 shrink-0 justify-end"><ShortcutKeys label={keys} /></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ShortcutKeys({ label }: { label: string }) {
  return (
    <kbd className="whitespace-nowrap rounded border border-line bg-cream px-2 py-0.5 font-mono text-xs text-ink-soft">
      {label}
    </kbd>
  );
}
