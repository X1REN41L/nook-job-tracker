"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { Dialog } from "@/components/dialog";
import { ShortcutKeycaps } from "@/components/shortcut-list";
import { compareApplications, matchesApplicationSearch } from "@/lib/application-list";
import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";
import { shortcutKeys, type DashboardShortcut } from "@/lib/keyboard-shortcuts";
import type { ApplicationSummary } from "@/types/application";

export type PaletteCommand = { id: string; label: string; group: "Pages" | "Actions"; keywords?: string; shortcut?: DashboardShortcut; run: () => void };
type PaletteItem = { id: string; label: string; detail?: string; dot?: string; shortcut?: DashboardShortcut; group: string; run: () => void };

const APPLICATION_LIMIT = 8;

export function CommandPalette({ applications, boards, commands, isMac, onClose, onOpenApplication }: {
  applications: ApplicationSummary[];
  boards: BoardConfiguration[];
  commands: PaletteCommand[];
  isMac: boolean;
  onClose: () => void;
  onOpenApplication: (application: ApplicationSummary) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const search = query.trim().toLowerCase();

  const matchingApplications = applications
    .filter((application) => matchesApplicationSearch(application, search))
    .sort((left, right) => Number(left.archived) - Number(right.archived) || compareApplications(left, right))
    .slice(0, search ? APPLICATION_LIMIT : 5);
  const items: PaletteItem[] = [
    ...commands
      .filter((command) => `${command.label} ${command.keywords ?? ""}`.toLowerCase().includes(search))
      .map((command) => ({ id: command.id, label: command.label, group: command.group, shortcut: command.shortcut, run: command.run })),
    ...matchingApplications.map((application) => ({
      id: `application-${application.id}`,
      label: `${application.role} — ${application.company}`,
      detail: `${boardLabel(boards, application.status)}${application.archived ? " · Archived" : ""}`,
      dot: boardDot(boards, application.status),
      group: search ? "Applications" : "Recent applications",
      run: () => onOpenApplication(application),
    })),
  ];
  const active = Math.min(activeIndex, Math.max(0, items.length - 1));
  const optionId = (index: number) => `${id}-option-${index}`;

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!items.length) return;
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      setActiveIndex(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active]);
    }
  }

  return (
    <Dialog
      backdropClassName="motion-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center bg-modal-backdrop/40 p-4 pt-[12vh] backdrop-blur-[2px]"
      className="motion-dialog-panel flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-nook-lg border border-line bg-paper shadow-nook-lift outline-none"
      initialFocusRef={inputRef}
      labelledBy={`${id}-title`}
      onClose={onClose}
    >
      <h2 className="sr-only" id={`${id}-title`}>Command palette</h2>
      <div className="border-b border-line px-4 py-3">
        <input
          ref={inputRef}
          aria-activedescendant={items.length ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-expanded="true"
          aria-label="Search pages, actions, and applications"
          className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-soft"
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Go to a page, run an action, or find an application…"
          role="combobox"
          type="text"
          value={query}
        />
      </div>
      <ul aria-label="Results" className="scrollbar-styled min-h-0 flex-1 overflow-y-auto p-2" id={`${id}-list`} role="listbox">
        {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-soft" role="presentation">No matches.</li>}
        {items.map((item, index) => (
          <li key={item.id} role="presentation">
            {(index === 0 || items[index - 1].group !== item.group) && (
              <p aria-hidden="true" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft">{item.group}</p>
            )}
            <div
              aria-selected={index === active}
              className={`flex cursor-pointer items-center gap-2.5 rounded-nook-sm px-3 py-2 text-sm ${index === active ? "bg-forest text-cream" : "text-ink"}`}
              id={optionId(index)}
              onClick={() => choose(item)}
              onMouseMove={() => { if (index !== active) setActiveIndex(index); }}
              role="option"
            >
              {item.dot && <span className={`status-dot shrink-0 ${item.dot} ${index === active ? "ring-1 ring-cream" : ""}`} />}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.detail && <span className={`shrink-0 text-xs ${index === active ? "text-cream/80" : "text-ink-soft"}`}>{item.detail}</span>}
              {item.shortcut && <PaletteShortcut active={index === active} id={item.shortcut} isMac={isMac} />}
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function PaletteShortcut({ id, isMac, active }: { id: DashboardShortcut; isMac: boolean; active: boolean }) {
  const shortcut = shortcutKeys(id, isMac);
  return shortcut && <ShortcutKeycaps inverted={active} keys={shortcut.keys} label={shortcut.text} size="small" />;
}
