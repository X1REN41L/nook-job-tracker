"use client";

import type { Status } from "@prisma/client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { ContactsSection, DetailsSection, FollowUpSection, InterviewsSection, SummarySection, TimelineSection, type HistoryEvent, type SaveChange } from "@/components/application-detail-sections";
import { Dialog } from "@/components/dialog";
import { applicationApiPath } from "@/lib/application-api-path";
import { boardDot, type BoardConfiguration } from "@/lib/board-preferences";
import { staleAgeLabel } from "@/lib/stale-label";
import { STATUS_META } from "@/lib/status-meta";
import type { ApplicationRecord } from "@/types/application";
import type { StaleApplication } from "@/types/dashboard";

function useApplicationHistory(application: ApplicationRecord) {
  const key = `${application.id}:${application.revision}`;
  const [result, setResult] = useState<{ key: string; events: HistoryEvent[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(applicationApiPath(application.id), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("History request failed");
        return response.json() as Promise<{ events: HistoryEvent[] }>;
      })
      .then((body) => {
        setResult({ key, events: body.events });
        setFailedKey(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load application history", reason);
        setFailedKey(key);
      });
    return () => controller.abort();
  }, [application.id, key]);

  return { events: result?.key === key ? result.events : null, error: failedKey === key };
}

export function ApplicationDetailPanel({ application, boards, today, stale, busy, sourceSuggestions, returnFocusRef, onClose, onChangeStatus, onArchive, onDelete, onSave }: {
  application: ApplicationRecord;
  boards: BoardConfiguration[];
  today: string;
  stale?: StaleApplication;
  busy: boolean;
  sourceSuggestions: string[];
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onChangeStatus: (status: Status) => void;
  onArchive: () => void;
  onDelete: () => void;
  onSave: SaveChange;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const [editingDetails, setEditingDetails] = useState(false);
  const { events, error } = useApplicationHistory(application);

  return (
    <Dialog
      backdropClassName="motion-dialog-backdrop fixed inset-0 z-50 flex justify-end bg-modal-backdrop/30"
      className="motion-dialog-panel flex h-full w-full max-w-md flex-col overflow-hidden border-l border-line bg-paper shadow-nook-lift outline-none"
      initialFocusRef={closeRef}
      labelledBy="application-detail-title"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      {/* The header and the action bar stay in view; only the content between them scrolls. */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Status changes go through the same move as the board, so history, undo, and the interview prompt apply. */}
            <label className="sr-only" htmlFor={statusId}>Status</label>
            <span className="relative inline-flex">
              <span aria-hidden="true" className={`status-dot pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${boardDot(boards, application.status)}`} />
              <select
                className={`badge ${STATUS_META[application.status].badge} cursor-pointer appearance-none py-1 pl-6 pr-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:cursor-default disabled:opacity-60`}
                disabled={busy}
                id={statusId}
                onChange={(event) => onChangeStatus(event.target.value as Status)}
                value={application.status}
              >
                {boards.map((board) => <option key={board.status} value={board.status}>{board.label}</option>)}
              </select>
              <svg aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </span>
            {application.archived && <span className="badge bg-cream-2 text-ink-soft">Archived</span>}
          </div>
          <h2 className="mt-3 break-words font-serif text-xl font-semibold leading-tight" id="application-detail-title">{application.role}</h2>
          <p className="mt-1 break-words text-sm text-ink-soft">{application.company}</p>
        </div>
        <button
          ref={closeRef}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="scrollbar-styled min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {stale && !application.archived && (
          <p className="mb-5 rounded-nook-sm border border-clay/40 bg-clay-tint px-3 py-2 text-sm text-ink">Needs attention · {staleAgeLabel(stale)}</p>
        )}
        <DetailsSection application={application} editing={editingDetails} onDone={() => setEditingDetails(false)} onSave={onSave} sourceSuggestions={sourceSuggestions} today={today} />
        <FollowUpSection application={application} onSave={onSave} today={today} />
        <InterviewsSection application={application} onSave={onSave} today={today} />
        <ContactsSection application={application} onSave={onSave} />
        <SummarySection application={application} onSave={onSave} />
        <TimelineSection boards={boards} events={events} loadError={error} onSave={onSave} />
      </div>

      <div className="flex shrink-0 gap-3 border-t border-line px-6 py-4">
        <button className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={busy} onClick={onArchive} type="button">
          {application.archived ? "Restore" : "Archive"}
        </button>
        <button className="btn-ghost mr-auto text-rose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose" disabled={busy} onClick={onDelete} type="button">
          Delete
        </button>
        <button className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={busy || editingDetails} onClick={() => setEditingDetails(true)} type="button">
          Edit details
        </button>
      </div>
    </Dialog>
  );
}
