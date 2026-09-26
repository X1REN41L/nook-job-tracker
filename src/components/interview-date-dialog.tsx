"use client";

import { useEffect, useRef } from "react";

import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap";
import { StableButtonLabel } from "@/components/stable-button-label";
import type { ApplicationRecord } from "@/types/application";

export function InterviewDateDialog({ application, error, onAddDate, onChangeDate, onClose, onSkip, saving, value }: {
  application: ApplicationRecord;
  error: string;
  onAddDate: () => void;
  onChangeDate: (value: string) => void;
  onClose: () => void;
  onSkip: () => void;
  saving: boolean;
  value: string;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(typeof document === "undefined" || !(document.activeElement instanceof HTMLElement) ? null : document.activeElement);

  useDialogFocusTrap(dialogRef, dateRef, returnFocusRef);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  return <div className="motion-dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-modal-backdrop/60 p-4 backdrop-blur-sm">
    <section ref={dialogRef} aria-describedby="interview-date-description" aria-labelledby="interview-date-title" aria-modal="true" className="motion-dialog-panel w-full max-w-md rounded-nook-lg border border-line bg-paper p-6 text-ink shadow-nook-lift outline-none" role="dialog" tabIndex={-1}>
      <h2 className="font-serif text-lg font-semibold" id="interview-date-title">Add interview date</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft" id="interview-date-description">When is the interview for <span className="font-medium text-ink">{application.role}</span> at <span className="font-medium text-ink">{application.company}</span>?</p>
      <label className="mt-4 block text-xs font-semibold text-ink-soft">
        Interview date
        <input ref={dateRef} className="input mt-1.5" disabled={saving} onChange={(event) => onChangeDate(event.target.value)} required type="date" value={value} />
      </label>
      {error && <p className="mt-3 text-sm text-rose" role="alert">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={saving} onClick={onSkip} type="button">Skip</button>
        <button className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={saving} onClick={onAddDate} type="button"><StableButtonLabel label="Add date" busyLabel="Saving…" busy={saving} /></button>
      </div>
    </section>
  </div>;
}
