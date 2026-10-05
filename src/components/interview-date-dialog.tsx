"use client";

import { useRef } from "react";

import { Dialog, DIALOG_BACKDROP_TONE } from "@/components/dialog";
import { StableButtonLabel } from "@/components/stable-button-label";
import { INTERVIEW_TYPE_LABELS, INTERVIEW_TYPES } from "@/lib/interviews";
import type { ApplicationSummary } from "@/types/application";
import type { InterviewType } from "@prisma/client";

/** Asked when an application moves to Interview; the answer becomes its first interview round. */
export function InterviewDateDialog({ application, error, onAddDate, onChangeDate, onChangeType, onClose, onSkip, saving, value, type }: {
  application: ApplicationSummary;
  error: string;
  onAddDate: () => void;
  onChangeDate: (value: string) => void;
  onChangeType: (value: InterviewType) => void;
  type: InterviewType;
  onClose: () => void;
  onSkip: () => void;
  saving: boolean;
  value: string;
}) {
  const dateRef = useRef<HTMLInputElement | null>(null);

  return <Dialog backdropClassName={`motion-dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4 ${DIALOG_BACKDROP_TONE}`} className="motion-dialog-panel w-full max-w-md rounded-nook-lg border border-line bg-paper p-6 text-ink shadow-nook-lift outline-none" closeDisabled={saving} closeOnBackdrop={false} describedBy="interview-date-description" initialFocusRef={dateRef} labelledBy="interview-date-title" onClose={onClose}>
    <h2 className="font-serif text-lg font-semibold" id="interview-date-title">Add interview date</h2>
    <p className="mt-2 text-sm leading-6 text-ink-soft" id="interview-date-description">When is the interview for <span className="font-medium text-ink">{application.role}</span> at <span className="font-medium text-ink">{application.company}</span>?</p>
    <div className="mt-4 grid grid-cols-2 gap-3">
      <label className="block text-xs font-semibold text-ink-soft">
        Interview date
        <input ref={dateRef} className="input mt-1.5" disabled={saving} onChange={(event) => onChangeDate(event.target.value)} required type="date" value={value} />
      </label>
      <label className="block text-xs font-semibold text-ink-soft">
        Type
        <select className="input mt-1.5" disabled={saving} onChange={(event) => onChangeType(event.target.value as InterviewType)} value={type}>
          {INTERVIEW_TYPES.map((option) => <option key={option} value={option}>{INTERVIEW_TYPE_LABELS[option]}</option>)}
        </select>
      </label>
    </div>
    <p className="mt-2 text-xs text-ink-soft">You can add more rounds, times, and interviewers from the application&apos;s details.</p>
    {error && <p className="mt-3 text-sm text-rose" role="alert">{error}</p>}
    <div className="mt-6 flex justify-end gap-3">
      <button className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={saving} onClick={onSkip} type="button">Skip</button>
      <button className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={saving} onClick={onAddDate} type="button"><StableButtonLabel label="Add date" busyLabel="Saving…" busy={saving} /></button>
    </div>
  </Dialog>;
}
