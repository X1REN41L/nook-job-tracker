"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { useTheme } from "next-themes";
import { Columns3, DatabaseBackup, Keyboard, SlidersHorizontal } from "lucide-react";

import { ShortcutList } from "@/components/shortcut-list";
import { BoardSettings } from "@/components/board-settings";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap";
import { useBoards } from "@/lib/board-preferences";
import { DEFAULT_BOARD_KEY, DEFAULT_BOARD_STATUSES, MOTION_KEY, getDefaultBoard, getMotionMode, setPreference, subscribeToPreferences } from "@/lib/general-preferences";

type SettingsCategory = "general" | "board" | "shortcuts" | "backup";

const SETTINGS_CATEGORIES = [
  { id: "general", label: "General", Icon: SlidersHorizontal },
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "shortcuts", label: "Shortcuts", Icon: Keyboard },
  { id: "backup", label: "Backup & Restore", Icon: DatabaseBackup },
] satisfies Array<{ id: SettingsCategory; label: string; Icon: typeof SlidersHorizontal }>;
const subscribeToMount = () => () => {};

export function SettingsModal({ isMac, onClose, onExport, onImport, importProgress, returnFocusRef, suspendFocusTrap }: {
  isMac: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<string | null>;
  importProgress: { current: number; total: number } | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  suspendFocusTrap: boolean;
}) {
  const [category, setCategory] = useState<SettingsCategory>("general");
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeToMount, () => true, () => false);
  const defaultBoard = useSyncExternalStore(subscribeToPreferences, getDefaultBoard, () => DEFAULT_BOARD_STATUSES[0]);
  const boards = useBoards();
  const motion = useSyncExternalStore(subscribeToPreferences, getMotionMode, () => "system");
  const [importError, setImportError] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const wasSuspendedRef = useRef(false);
  useDialogFocusTrap(dialogRef, closeRef, returnFocusRef, suspendFocusTrap);

  useEffect(() => {
    if (wasSuspendedRef.current && !suspendFocusTrap) closeRef.current?.focus();
    wasSuspendedRef.current = suspendFocusTrap;
  }, [suspendFocusTrap]);

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setImportError("");
    const error = await onImport(file);
    if (error) setImportError(error);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-modal-backdrop/40 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} aria-labelledby="settings-title" aria-modal="true" className="flex h-[min(42rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-nook-lg border border-line bg-paper text-ink shadow-nook-lift outline-none" role="dialog" tabIndex={-1}>
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-serif text-xl font-semibold" id="settings-title">Settings</h2>
          <button ref={closeRef} aria-label="Close settings" className="icon-btn shrink-0" onClick={onClose} type="button">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)] sm:grid-cols-[190px_minmax(0,1fr)]">
          <nav aria-label="Settings categories" className="flex min-h-0 flex-col border-r border-line bg-cream p-2.5">
            {SETTINGS_CATEGORIES.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-current={category === id ? "page" : undefined}
                className={`grid h-9 w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-nook-sm border px-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${id === "backup" ? "mt-auto" : ""} ${category === id ? "border-forest bg-forest text-cream" : "border-transparent text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
                onClick={() => setCategory(id)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.75} />
                <span className="-mr-px min-w-0 leading-tight">{label}</span>
              </button>
            ))}
          </nav>

          <div className="scrollbar-styled min-h-0 overflow-y-auto p-5 sm:p-6">
            {category === "general" && (
              <div>
                <h3 className="font-serif text-lg font-semibold">General</h3>
                <div className="mt-5 divide-y divide-line border-y border-line">
                  <div className="flex min-h-16 items-center justify-between gap-3 py-3">
                    <span className="text-sm font-semibold">Theme</span>
                    <div aria-label="Theme" className="flex shrink-0 rounded-nook-sm border border-line bg-cream p-0.5" role="group">
                      {(["system", "light", "dark"] as const).map((mode) => (
                        <button key={mode} aria-label={`Use ${mode} theme`} aria-pressed={mounted && theme === mode} className={`flex h-8 w-9 items-center justify-center rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${mounted && theme === mode ? "bg-paper text-forest shadow-sm" : "text-ink-soft hover:text-ink"}`} disabled={!mounted} onClick={() => setTheme(mode)} type="button">
                          <ThemeIcon mode={mode} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex min-h-16 items-center justify-between gap-3 py-3">
                    <label className="text-sm font-semibold" htmlFor="default-board">New Applications Default Board</label>
                    <select className="min-w-32 max-w-40 rounded-nook-sm border border-line bg-cream px-2 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" id="default-board" onChange={(event) => setPreference(DEFAULT_BOARD_KEY, event.target.value)} value={defaultBoard}>
                      {boards.map((board) => <option key={board.status} value={board.status}>{board.label}</option>)}
                    </select>
                  </div>
                  <div className="flex min-h-16 items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-semibold">Motion</p>
                      <p className="mt-0.5 text-xs text-ink-soft">Reduce animations and transitions throughout the interface.</p>
                    </div>
                    <div aria-label="Motion" className="flex shrink-0 rounded-nook-sm border border-line bg-cream p-0.5" role="group">
                      {(["system", "reduced"] as const).map((mode) => (
                        <button key={mode} aria-pressed={motion === mode} className={`rounded-[8px] px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${motion === mode ? "bg-paper text-forest shadow-sm" : "text-ink-soft hover:text-ink"}`} onClick={() => setPreference(MOTION_KEY, mode)} type="button">{mode === "system" ? "System" : "Reduced"}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {category === "board" && <BoardSettings />}

            {category === "shortcuts" && (
              <div>
                <h3 className="font-serif text-lg font-semibold">Keyboard Shortcuts</h3>
                <ShortcutList className="mt-4" isMac={isMac} />
              </div>
            )}

            {category === "backup" && (
              <div>
                <h3 className="font-serif text-lg font-semibold">Backup &amp; Restore</h3>
                <div className="mt-5 divide-y divide-line border-y border-line">
                  <BackupAction description="Restore applications and settings from a Nook backup." disabled={importProgress !== null} label="Import" onClick={() => importInputRef.current?.click()} title="Import data" />
                  <BackupAction description="Download a backup of your applications and settings." label="Export" onClick={onExport} title="Export data" />
                </div>
                <input ref={importInputRef} accept="application/json,.json" className="sr-only" onChange={(event) => { void handleImport(event.target.files?.[0]); event.target.value = ""; }} tabIndex={-1} type="file" />
                {importProgress && <p className="mt-3 text-sm text-ink-soft" role="status">Importing {importProgress.current} of {importProgress.total}…</p>}
                {importError && <p className="mt-3 text-sm text-rose" role="alert">{importError}</p>}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ThemeIcon({ mode }: { mode: "system" | "light" | "dark" }) {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {mode === "system" && <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></>}
      {mode === "light" && <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>}
      {mode === "dark" && <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />}
    </svg>
  );
}

function BackupAction({ description, disabled = false, label, onClick, title }: { description: string; disabled?: boolean; label: string; onClick: () => void; title: string }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-ink-soft">{description}</p>
      </div>
      <button className="shrink-0 rounded-nook-sm border border-line bg-cream px-3 py-2 text-sm font-medium text-ink transition hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} onClick={onClick} type="button">{label}</button>
    </div>
  );
}
