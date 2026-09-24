"use client";

import {
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { Status } from "@prisma/client";
import { CSS } from "@dnd-kit/utilities";

import { formatAppliedDate } from "@/lib/application-date";
import { BOARD_COLOR_CLASSES, type BoardConfiguration } from "@/lib/board-preferences";
import type { ApplicationRecord } from "@/types/application";

export function KanbanBoard({ applications, boards, dropDisabled = false, movingId, onEdit }: {
  applications: ApplicationRecord[];
  boards: BoardConfiguration[];
  dropDisabled?: boolean;
  movingId: string | null;
  onEdit: (application: ApplicationRecord) => void;
}) {
  return (
    <div className="board-columns flex h-full min-h-0 items-stretch gap-4" aria-label="Application status board">
      {boards.map((board) => {
        const items = applications.filter((application) => !application.archived && application.status === board.status);
        return <KanbanColumn key={board.status} board={board} applications={items} dropDisabled={dropDisabled} movingId={movingId} onEdit={onEdit} />;
      })}
    </div>
  );
}

function KanbanColumn({ board, applications, dropDisabled, movingId, onEdit }: {
  board: BoardConfiguration;
  applications: ApplicationRecord[];
  dropDisabled: boolean;
  movingId: string | null;
  onEdit: (application: ApplicationRecord) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: board.status, disabled: dropDisabled });
  return (
    <section ref={setNodeRef} className={`flex h-full min-h-0 w-[272px] shrink-0 flex-col rounded-nook-lg border p-3 transition-colors ${isOver ? "border-forest bg-forest-tint" : "border-line bg-cream-2"}`}>
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2 px-1.5 pt-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><span className={`status-dot ${BOARD_COLOR_CLASSES[board.color]}`} />{board.label}</h3>
        <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs font-medium text-ink-soft">{applications.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        <div className="flex flex-col gap-2.5">
        {applications.map((application) => (
          <KanbanCard key={application.id} application={application} disabled={movingId !== null} onEdit={onEdit} />
        ))}
        {applications.length === 0 && (
          <p className="mt-1 rounded-nook border border-dashed border-line px-3 py-5 text-center text-xs leading-5 text-ink-soft">
            {board.emptyText}
          </p>
        )}
        </div>
      </div>
    </section>
  );
}

function KanbanCard({ application, disabled, onEdit }: {
  application: ApplicationRecord;
  disabled: boolean;
  onEdit: (application: ApplicationRecord) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    data: { applicationId: application.id, label: `${application.role} at ${application.company}`, source: "board", status: application.status },
    disabled,
  });
  let postingUrl: string | undefined;
  try {
    const candidate = application.jobUrl?.trim();
    if (candidate && ["http:", "https:"].includes(new URL(candidate).protocol)) postingUrl = candidate;
  } catch {
    // Ignore invalid URLs so the company line stays unchanged.
  }

  return (
    <article
      ref={setNodeRef}
      data-application-id={application.id}
      data-kanban-card-id={application.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`card kanban-card-focus touch-none cursor-grab p-3.5 active:cursor-grabbing ${isDragging ? "opacity-0" : ""}`}
      onClick={() => { if (!disabled && !isDragging) onEdit(application); }}
      {...attributes}
      {...listeners}
      aria-label={`Edit or move ${application.role} at ${application.company}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !disabled && !isDragging) { event.preventDefault(); onEdit(application); }
        else listeners?.onKeyDown?.(event);
      }}
    >
      <h4 className="truncate font-serif text-[15px] font-semibold">{application.role}</h4>
      <p className={`mb-2 mt-0.5 text-[13px] text-ink-soft ${postingUrl ? "flex items-center gap-1" : "truncate"}`}>
        {postingUrl ? <span className="min-w-0 truncate">{application.company}</span> : application.company}
        {postingUrl && (
          <a
            aria-label="Open job posting in a new tab"
            className="inline-flex shrink-0 text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
            href={postingUrl}
            rel="noopener noreferrer"
            target="_blank"
            title="Open job posting"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </a>
        )}
      </p>
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {formatAppliedDate(application.appliedDate)}
      </div>
      {application.status === Status.INTERVIEW && application.interviewDate && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-soft">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Interview {formatAppliedDate(application.interviewDate)}
        </div>
      )}
    </article>
  );
}

export function KanbanCardOverlay({ application }: { application: ApplicationRecord }) {
  return (
    <div className="card w-[272px] rotate-2 border-forest p-3.5 shadow-nook-lift">
      <p className="font-serif text-[15px] font-semibold">{application.role}</p>
      <p className="mt-0.5 text-[13px] text-ink-soft">{application.company}</p>
    </div>
  );
}
