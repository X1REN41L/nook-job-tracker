"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode, RefObject } from "react";
import { DatabaseBackup, Keyboard, SlidersHorizontal } from "lucide-react";

import { ShortcutList } from "@/components/shortcut-list";
import { DeleteAllDataDialog } from "@/components/delete-all-data-dialog";
import { Dialog } from "@/components/dialog";
import { MODAL_HEADER_CLASS, MODAL_SHELL_CLASS } from "@/components/settings-modal-shell";
import { useSettings } from "@/hooks/use-settings";
import { useSettingsUpdate } from "@/hooks/use-settings-update";
import { STALE_THRESHOLDS, STARTUP_PAGE_LABELS, STARTUP_PAGES, TIME_FORMATS, WEEK_START_LABELS, WEEK_STARTS } from "@/lib/settings-values";
import { MOTION_MODES } from "@/lib/motion-mode";

type SettingsCategory = "general" | "shortcuts" | "backup";

const SETTINGS_CATEGORIES = [
  { id: "general", label: "General", Icon: SlidersHorizontal },
  { id: "shortcuts", label: "Shortcuts", Icon: Keyboard },
  { id: "backup", label: "Backup & restore", Icon: DatabaseBackup },
] satisfies Array<{ id: SettingsCategory; label: string; Icon: typeof SlidersHorizontal }>;
// One fixed width, wide enough for the longest option, keeps the dropdowns' edges in line.
const settingsSelectClass = "w-44 rounded-nook-sm border border-line bg-cream px-2 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";
const segmentedGroupClass = "flex shrink-0 rounded-nook-sm border border-line bg-cream p-0.5";
const subscribeToMount = () => () => {};

// Every segment is the same height, so icon and text controls line up.
function segmentClass(selected: boolean) {
  return `flex h-8 items-center justify-center rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${selected ? "bg-paper text-forest shadow-sm" : "text-ink-soft hover:text-ink"}`;
}

export function SettingsModal({ isMac, onClose, onExport, onImport, onDeleteAll, deleteDisabled, importProgress, returnFocusRef, showToast }: {
  isMac: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => Promise<string | null>;
  onDeleteAll: () => Promise<boolean>;
  deleteDisabled: boolean;
  importProgress: { current: number; total: number } | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  showToast: (message: string) => void;
}) {
  const [category, setCategory] = useState<SettingsCategory>("general");
  const settings = useSettings();
  const theme = settings.theme;
  const saveSettings = useSettingsUpdate(showToast);
  const mounted = useSyncExternalStore(subscribeToMount, () => true, () => false);
  const startupPage = settings.startupPage;
  const staleThreshold = settings.staleApplicationThreshold;
  const motion = settings.motion;
  const timeFormat = settings.timeFormat;
  const weekStart = settings.weekStart;
  const [importError, setImportError] = useState("");
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const deleteInFlight = useRef(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);

  function openDeleteConfirmation() {
    if (deleteDisabled || importProgress || deleteInFlight.current) return;
    deleteReturnFocusRef.current = deleteTriggerRef.current;
    setDeleteConfirmationOpen(true);
  }

  function closeDeleteConfirmation() {
    if (deleteInFlight.current) return;
    setDeleteConfirmationOpen(false);
  }

  async function confirmDeleteAll() {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeletingAll(true);
    try {
      if (await onDeleteAll()) {
        setImportError("");
        setDeleteConfirmationOpen(false);
      }
    } finally {
      deleteInFlight.current = false;
      setDeletingAll(false);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setImportError("");
    const error = await onImport(file);
    if (error) setImportError(error);
  }

  return (
    <>
      <Dialog backdropClassName="motion-dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-modal-backdrop/40 p-4 backdrop-blur-[2px]" className={MODAL_SHELL_CLASS} closeDisabled={deleteConfirmationOpen} initialFocusRef={closeRef} labelledBy="settings-title" onClose={onClose} returnFocusRef={returnFocusRef}>
        <div className={MODAL_HEADER_CLASS}>
          <h2 className="font-serif text-xl font-semibold" id="settings-title">Settings</h2>
          <button ref={closeRef} aria-label="Close settings" className="icon-btn shrink-0" disabled={deleteConfirmationOpen} onClick={onClose} type="button">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)] sm:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Settings categories" className="flex min-h-0 flex-col border-r border-line bg-cream p-2.5">
            {SETTINGS_CATEGORIES.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-current={category === id ? "page" : undefined}
                className={`grid h-9 w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-nook-sm border px-3 text-left text-sm font-medium motion-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${id === "backup" ? "mt-auto" : ""} ${category === id ? "border-forest bg-forest text-cream" : "border-transparent text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
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
                  <SettingRow label="Theme">
                    <div aria-label="Theme" className={segmentedGroupClass} role="group">
                      {(["system", "light", "dark"] as const).map((mode) => (
                        <button key={mode} aria-label={`Use ${mode} theme`} aria-pressed={mounted && theme === mode} className={`${segmentClass(mounted && theme === mode)} w-9`} disabled={!mounted} onClick={() => saveSettings({ theme: mode })} title={`${mode[0].toUpperCase()}${mode.slice(1)}`} type="button">
                          <ThemeIcon mode={mode} />
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow label="Motion">
                    <div aria-label="Motion" className={segmentedGroupClass} role="group">
                      {MOTION_MODES.map((mode) => (
                        <button key={mode} aria-pressed={motion === mode} className={`${segmentClass(motion === mode)} px-3 text-xs font-medium`} onClick={() => saveSettings({ motion: mode })} type="button">{mode === "system" ? "System" : mode === "on" ? "On" : "Off"}</button>
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow htmlFor="startup-page" label="Startup page">
                    <select className={settingsSelectClass} id="startup-page" onChange={(event) => saveSettings({ startupPage: event.target.value as typeof startupPage })} value={startupPage}>
                      {STARTUP_PAGES.map((page) => <option key={page} value={page}>{STARTUP_PAGE_LABELS[page]}</option>)}
                    </select>
                  </SettingRow>
                  <SettingRow description="Flags active applications with no progress." htmlFor="stale-threshold" label="Stale after">
                    <select className={settingsSelectClass} id="stale-threshold" onChange={(event) => saveSettings({ staleApplicationThreshold: Number(event.target.value) as typeof staleThreshold })} value={staleThreshold}>
                      {STALE_THRESHOLDS.map((days) => <option key={days} value={days}>{days} days</option>)}
                    </select>
                  </SettingRow>
                  <SettingRow label="Time format">
                    <div aria-label="Time format" className={segmentedGroupClass} role="group">
                      {TIME_FORMATS.map((format) => (
                        <button key={format} aria-pressed={timeFormat === format} className={`${segmentClass(timeFormat === format)} px-3 text-xs font-medium`} onClick={() => saveSettings({ timeFormat: format })} type="button">{format === "system" ? "Automatic" : format === "12h" ? "12-hour" : "24-hour"}</button>
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow htmlFor="week-start" label="Week starts on">
                    <select className={settingsSelectClass} id="week-start" onChange={(event) => saveSettings({ weekStart: event.target.value as typeof weekStart })} value={weekStart}>
                      {WEEK_STARTS.map((option) => <option key={option} value={option}>{WEEK_START_LABELS[option]}</option>)}
                    </select>
                  </SettingRow>
                </div>
              </div>
            )}

            {category === "shortcuts" && (
              <div>
                <h3 className="font-serif text-lg font-semibold">Keyboard shortcuts</h3>
                <ShortcutList className="mt-4" isMac={isMac} />
              </div>
            )}

            {category === "backup" && (
              <div>
                <h3 className="font-serif text-lg font-semibold">Backup &amp; restore</h3>
                <div className="mt-5 divide-y divide-line border-y border-line">
                  <BackupAction description="Adds the backup's applications and replaces your settings." disabled={importProgress !== null} label="Import" onClick={() => importInputRef.current?.click()} title="Import data" />
                  <BackupAction label="Export" onClick={onExport} title="Export data" />
                </div>
                <div className="mt-7 border-t border-line pt-5">
                  <h4 className="font-serif text-base font-semibold text-rose">Delete all data</h4>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-soft">Permanently remove all applications and their history. Your settings will be kept.</p>
                    <button ref={deleteTriggerRef} className="btn-danger shrink-0 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose disabled:cursor-not-allowed" disabled={deleteDisabled || importProgress !== null || deletingAll} onClick={openDeleteConfirmation} type="button">Delete all data</button>
                  </div>
                </div>
                <input ref={importInputRef} accept="application/json,.json" className="sr-only" onChange={(event) => { void handleImport(event.target.files?.[0]); event.target.value = ""; }} tabIndex={-1} type="file" />
                {importProgress && <p className="mt-3 text-sm text-ink-soft" role="status">Importing {importProgress.current} of {importProgress.total}…</p>}
                {importError && <p className="mt-3 text-sm text-rose" role="alert">{importError}</p>}
              </div>
            )}
          </div>
        </div>
      </Dialog>
      {deleteConfirmationOpen && <DeleteAllDataDialog deleting={deletingAll} onCancel={closeDeleteConfirmation} onConfirm={() => { void confirmDeleteAll(); }} returnFocusRef={deleteReturnFocusRef} />}
    </>
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

function SettingRow({ children, description, htmlFor, label }: { children: ReactNode; description?: string; htmlFor?: string; label: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        {htmlFor ? <label className="text-sm font-semibold" htmlFor={htmlFor}>{label}</label> : <p className="text-sm font-semibold">{label}</p>}
        {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function BackupAction({ description, disabled = false, label, onClick, title }: { description?: string; disabled?: boolean; label: string; onClick: () => void; title: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
      </div>
      <button className="shrink-0 rounded-nook-sm border border-line bg-cream px-3 py-2 text-sm font-medium text-ink motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} onClick={onClick} type="button">{label}</button>
    </div>
  );
}
