"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { ContactsSection, FollowUpSection, InterviewsSection, TimelineSection, type HistoryEvent, type SaveChange } from "@/components/application-detail-sections";
import { Dialog } from "@/components/dialog";
import { applicationApiPath } from "@/lib/application-api-path";
import { formatCalendarDate, formatDaysAgo } from "@/lib/application-date";
import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";
import { staleAgeLabel } from "@/lib/stale-label";
import { STATUS_META } from "@/lib/status-meta";
import type { ApplicationRecord } from "@/types/application";
import type { StaleApplication } from "@/types/dashboard";

function safePostingUrl(value: string | null) {
  try {
    const candidate = value?.trim();
    if (candidate && ["http:", "https:"].includes(new URL(candidate).protocol)) return candidate;
  } catch {
    // An invalid link is shown as plain text instead.
  }
  return undefined;
}

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

export function ApplicationDetailPanel({ application, boards, today, stale, busy, returnFocusRef, onClose, onEdit, onArchive, onDelete, onSave }: {
  application: ApplicationRecord;
  boards: BoardConfiguration[];
  today: string;
  stale?: StaleApplication;
  busy: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onSave: SaveChange;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { events, error } = useApplicationHistory(application);
  const postingUrl = safePostingUrl(application.jobUrl);
  const notes = application.notes?.trim();

  return (
    <Dialog
      backdropClassName="motion-dialog-backdrop fixed inset-0 z-50 flex justify-end bg-modal-backdrop/30"
      className="motion-dialog-panel scrollbar-styled flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-paper shadow-nook-lift outline-none"
      initialFocusRef={closeRef}
      labelledBy="application-detail-title"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <span className={`badge ${STATUS_META[application.status].badge}`}>
            <span className={`status-dot ${boardDot(boards, application.status)}`} />{boardLabel(boards, application.status)}
          </span>
          {application.archived && <span className="badge ml-2 bg-cream-2 text-ink-soft">Archived</span>}
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

      <div className="flex-1 px-6 py-5">
        {stale && !application.archived && (
          <p className="mb-5 rounded-nook-sm border border-clay/40 bg-clay-tint px-3 py-2 text-sm text-ink">Needs attention · {staleAgeLabel(stale)}</p>
        )}
        <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <Detail label="Applied">{formatCalendarDate(application.appliedDate)} <span className="text-ink-soft">· {formatDaysAgo(application.appliedDate, today)}</span></Detail>
          <Detail label="Source">{application.source?.trim() || <span className="text-ink-soft">Not set</span>}</Detail>
          <Detail label="Job link">
            {postingUrl ? (
              <a className="break-all text-forest underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" href={postingUrl} rel="noopener noreferrer" target="_blank">
                {postingUrl}
              </a>
            ) : application.jobUrl?.trim() ? <span className="break-all">{application.jobUrl}</span> : <span className="text-ink-soft">Not set</span>}
          </Detail>
        </dl>

        <FollowUpSection application={application} onSave={onSave} today={today} />
        <InterviewsSection application={application} onSave={onSave} today={today} />
        <ContactsSection application={application} onSave={onSave} />

        <section aria-labelledby="application-detail-notes" className="mt-7">
          <h3 className="font-serif text-base font-semibold" id="application-detail-notes">Summary</h3>
          {notes
            ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{notes}</p>
            : <p className="mt-2 text-sm text-ink-soft">No summary yet. Add one with Edit.</p>}
        </section>

        <TimelineSection boards={boards} events={events} loadError={error} onSave={onSave} />
      </div>

      <div className="flex gap-3 border-t border-line px-6 py-4">
        <button className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={busy} onClick={onArchive} type="button">
          {application.archived ? "Restore" : "Archive"}
        </button>
        <button className="btn-ghost mr-auto text-rose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose" disabled={busy} onClick={onDelete} type="button">
          Delete
        </button>
        <button className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper" disabled={busy} onClick={onEdit} type="button">
          Edit
        </button>
      </div>
    </Dialog>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
