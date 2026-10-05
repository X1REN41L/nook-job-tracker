"use client";

import type { FormEvent } from "react";
import { useRef } from "react";
import { Status } from "@prisma/client";

import { boardDot, type BoardConfiguration } from "@/lib/board-preferences";
import { Dialog, DIALOG_BACKDROP_TONE } from "@/components/dialog";
import { StableButtonLabel } from "@/components/stable-button-label";
import type { JobFormState } from "@/types/application";

/** The form for adding a job; existing applications are edited in the application view. */
export function JobModal({
  boards,
  form,
  error,
  saving,
  onChangeField,
  onClose,
  onSubmit,
  sourceSuggestions,
}: {
  boards: BoardConfiguration[];
  form: JobFormState;
  error: string;
  saving: boolean;
  onChangeField: <K extends keyof JobFormState>(field: K, value: JobFormState[K]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Sources used on earlier applications, offered as suggestions. */
  sourceSuggestions: string[];
}) {
  const companyRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      backdropClassName={`motion-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center p-4 py-[6vh] ${DIALOG_BACKDROP_TONE}`}
      busy={saving}
      className="motion-dialog-panel flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-nook-lg border border-line bg-paper shadow-nook-lift outline-none"
      closeDisabled={saving}
      initialFocusRef={companyRef}
      labelledBy="job-modal-title"
      onClose={onClose}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
        <h2 className="font-serif text-xl font-semibold" id="job-modal-title">
          Add a job
        </h2>
        <button
          aria-label="Close"
          disabled={saving}
          className="icon-btn shrink-0"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* The title and the buttons stay in view on short screens; the fields scroll between them. */}
      <form className="flex min-h-0 flex-col" onSubmit={onSubmit} noValidate>
        <div className="scrollbar-styled flex min-h-0 flex-col gap-3.5 overflow-y-auto px-6 pb-4 pt-4">
          <Field label="Company">
            <input
              ref={companyRef}
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
                  {boards.map((board) => (
                    <option key={board.status} value={board.status}>
                      {board.label}
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

          <Field label="Source" hint="(optional)">
            <input
              className="input"
              list="job-source-suggestions"
              maxLength={120}
              onChange={(e) => onChangeField("source", e.target.value)}
              placeholder="LinkedIn, referral…"
              value={form.source}
            />
            <datalist id="job-source-suggestions">
              {sourceSuggestions.map((source) => <option key={source} value={source} />)}
            </datalist>
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

          {error && (
            <p className="text-sm text-rose" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-line px-6 py-4">
          <button className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={saving} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={saving} type="submit">
            <StableButtonLabel label="Save job" busyLabel="Saving…" busy={saving} />
          </button>
        </div>
      </form>
    </Dialog>
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
