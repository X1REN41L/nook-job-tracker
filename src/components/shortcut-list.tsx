import { shortcutLabels } from "@/lib/keyboard-shortcuts";

export function ShortcutList({ className = "", isMac }: { className?: string; isMac: boolean }) {
  return (
    <div className={`${className} divide-y divide-line`}>
      {shortcutLabels(isMac).map(({ action, keys }) => (
        <div className="flex items-center justify-between gap-4 py-2.5 text-sm" key={action}>
          <span>{action}</span>
          <ShortcutKeys label={keys} />
        </div>
      ))}
    </div>
  );
}

function ShortcutKeys({ label }: { label: string }) {
  return (
    <kbd className="rounded border border-line bg-cream px-2 py-0.5 font-sans text-xs text-ink-soft">
      {label}
    </kbd>
  );
}
