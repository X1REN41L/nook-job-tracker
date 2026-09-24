"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { formatAppliedDate } from "@/lib/application-date";
import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";
import type { DuplicateMatch } from "@/lib/duplicate-match";
import { STATUS_META } from "@/lib/status-meta";
import type { ApplicationRecord } from "@/types/application";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap";

export function DuplicateWarningDialog({ boards, editing, fromImport = false, match, saving, onAddAnyway, onDismiss, onViewExisting }: {
  boards: BoardConfiguration[];
  editing: boolean;
  fromImport?: boolean;
  match: DuplicateMatch<ApplicationRecord>;
  saving: boolean;
  onAddAnyway: () => void;
  onDismiss: () => void;
  onViewExisting: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const viewExistingRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { returnFocusRef.current = document.activeElement as HTMLElement; }, []);
  useDialogFocusTrap(dialogRef, viewExistingRef, returnFocusRef);
  const dismissRef = useRef(onDismiss);
  const savingRef = useRef(saving);
  const { application } = match;
  const meta = STATUS_META[application.status];

  useEffect(() => {
    dismissRef.current = onDismiss;
    savingRef.current = saving;
  }, [onDismiss, saving]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        dismissRef.current();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onDismiss(); }}
    >
      <section
        ref={dialogRef}
        aria-describedby="duplicate-description"
        aria-labelledby="duplicate-title"
        aria-modal="true"
        className="w-full max-w-md rounded-nook-lg border border-line bg-paper p-6 text-ink shadow-nook-lift outline-none"
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-gold">Worth a quick look</p>
            <h2 className="font-serif text-xl font-semibold" id="duplicate-title">Possible duplicate</h2>
          </div>
          <button
            aria-label="Back to job form"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-cream-2"
            disabled={saving}
            onClick={onDismiss}
            type="button"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-ink-soft" id="duplicate-description">
          {match.kind === "exact"
            ? "You already have an application with the same company and role."
            : "This looks very similar to an application you already have."}
        </p>

        <div className="mt-4 rounded-nook border border-line bg-cream p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-serif text-base font-semibold">{application.role}</p>
              <p className="mt-0.5 truncate text-sm text-ink-soft">{application.company}</p>
            </div>
            <span className={`badge shrink-0 ${meta.badge}`}><span className={`status-dot ${boardDot(boards, application.status)}`} />{boardLabel(boards, application.status)}</span>
          </div>
          <p className="mt-3 text-xs text-ink-soft">Applied {formatAppliedDate(application.appliedDate)}</p>
        </div>

        <p className="mt-4 text-sm leading-6 text-ink-soft">
          {fromImport ? "This backup contains a similar earlier entry. You can cancel the import or add both entries." : <>You can review the existing application or {editing ? "save these changes" : "add this application"} anyway.</>}
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button ref={viewExistingRef} className="btn-ghost" disabled={saving} onClick={onViewExisting} type="button">
            {fromImport ? "Cancel import" : "View existing"}
          </button>
          <button className="btn-primary" disabled={saving} onClick={onAddAnyway} type="button">
            {saving ? "Saving…" : editing ? "Save anyway" : "Add anyway"}
          </button>
        </div>
      </section>
    </div>
  );
}
