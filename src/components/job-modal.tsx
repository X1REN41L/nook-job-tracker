"use client";

import type { FormEvent } from "react";
import { useEffect, useRef } from "react";
import { Status } from "@prisma/client";

import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";

export type JobFormState = {
  company: string;
  role: string;
  status: Status;
  source: string;
  appliedDate: string;
  interviewDate: string;
  notes: string;
  jobUrl: string;
};

const statuses = Object.values(Status);

export function JobModal({
  boards,
  editing,
  form,
  error,
  saving,
  onChangeField,
  onClose,
  onSubmit,
  onRequestDelete,
}: {
  boards: BoardConfiguration[];
  editing: boolean;
  form: JobFormState;
  error: string;
  saving: boolean;
  onChangeField: <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRequestDelete?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => { closeRef.current = onClose; savingRef.current = saving; }, [onClose, saving]);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    function focusableControls() {
      if (!dialogRef.current) return [];
      return Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!savingRef.current) closeRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = focusableControls();
      if (!controls.length) { event.preventDefault(); dialogRef.current.focus(); return; }

      const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? controls.length - 1 : currentIndex - 1
        : currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1;
      event.preventDefault();
      controls[nextIndex]?.focus();
    }
    function keepFocusInside(event: FocusEvent) {
      if (!dialogRef.current || dialogRef.current.contains(event.target as Node)) return;
      (focusableControls()[0] ?? dialogRef.current).focus();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  return (
    <div
      className="scrollbar-styled fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-modal-backdrop/40 p-4 py-[6vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div ref={dialogRef} tabIndex={-1} className="w-full max-w-md rounded-nook-lg border border-line bg-paper shadow-nook-lift outline-none" role="dialog" aria-modal="true" aria-labelledby="job-modal-title" aria-busy={saving}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-serif text-lg font-semibold" id="job-modal-title">
            {editing ? "Edit job" : "Add a job"}
          </h2>
          <button
            aria-label="Close"
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
            onClick={onClose}
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="flex flex-col gap-3.5 px-6 pb-1 pt-4" onSubmit={onSubmit} noValidate>
          <Field label="Company">
            <input
              className="input"
              maxLength={120}
              onChange={(e) => onChangeField("company", e.target.value)}
              placeholder="e.g. Alderfield & Co."
              required
              value={form.company}
            />
          </Field>

          <Field label="Role">
            <input
              className="input"
              maxLength={120}
              onChange={(e) => onChangeField("role", e.target.value)}
              placeholder="e.g. Senior Product Designer"
              required
              value={form.role}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status" className="flex-1">
              <div className="relative">
                <span
                  className={`status-dot pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${boardDot(boards, form.status)}`}
                />
                <select
                  className="input appearance-none pl-7"
                  onChange={(e) => onChangeField("status", e.target.value as Status)}
                  value={form.status}
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {boardLabel(boards, status)}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Date applied" className="flex-1">
              <input
                className="input"
                onChange={(e) => onChangeField("appliedDate", e.target.value)}
                required
                type="date"
                value={form.appliedDate}
              />
            </Field>
          </div>

          <Field label="Interview date" hint="(optional)">
            <input
              className="input"
              onChange={(e) => onChangeField("interviewDate", e.target.value)}
              type="date"
              value={form.interviewDate}
            />
          </Field>

          <Field label="Source">
            <input
              className="input"
              maxLength={120}
              onChange={(e) => onChangeField("source", e.target.value)}
              placeholder="LinkedIn, referral…"
              value={form.source}
            />
          </Field>

          <div className="text-xs font-semibold text-ink-soft">
            <div className="flex items-center gap-2">
              <label htmlFor="job-url">Job link <span className="font-normal">(optional)</span></label>
            </div>
            <input
              className="input mt-1.5"
              id="job-url"
              maxLength={2000}
              onChange={(e) => onChangeField("jobUrl", e.target.value)}
              placeholder="https://…"
              type="url"
              value={form.jobUrl}
            />
          </div>

          <Field label="Notes" hint="(optional)">
            <textarea
              className="scrollbar-styled input min-h-20 resize-y"
              maxLength={5000}
              onChange={(e) => onChangeField("notes", e.target.value)}
              placeholder="Recruiter contact, salary range, next steps…"
              value={form.notes}
            />
          </Field>

          {error && (
            <p className="text-sm text-rose" role="alert">
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-3 pb-6">
            {editing && onRequestDelete && (
              <button className="btn-danger mr-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={saving} onClick={onRequestDelete} type="button">
                Delete
              </button>
            )}
            <button className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={saving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={saving} type="submit">
              {saving ? "Saving…" : "Save job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-xs font-semibold text-ink-soft ${className ?? ""}`}>
      {label} {hint && <span className="font-normal">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
