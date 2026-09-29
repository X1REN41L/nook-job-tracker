"use client";

import {
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { Status } from "@prisma/client";
import { CSS } from "@dnd-kit/utilities";
import { useId, useLayoutEffect, useRef } from "react";

import { useScrollbarActivity } from "@/hooks/use-scrollbar-activity";
import { formatCalendarDate, formatDaysAgo } from "@/lib/application-date";
import type { BoardConfiguration } from "@/lib/board-preferences";
import { motionIsCurrentlyOff } from "@/lib/general-preferences";
import { featuredInterview, formatInterviewTime, INTERVIEW_TYPE_LABELS } from "@/lib/interviews";
import type { ApplicationRecord } from "@/types/application";

type CardContext = {
  today: string;
  staleDays: ReadonlyMap<string, number>;
  onOpen: (application: ApplicationRecord) => void;
};

export function KanbanBoard({ applications, boards, dropDisabled = false, movingIds, emptyText, today, staleDays, onOpen }: {
  applications: ApplicationRecord[];
  boards: BoardConfiguration[];
  dropDisabled?: boolean;
  movingIds: ReadonlySet<string>;
  /** Replaces each column's empty-state text, e.g. while filters hide every card. */
  emptyText?: string;
} & CardContext) {
  const boardRef = useRef<HTMLDivElement>(null);
  const beforeUpdate = useRef(new Map<string, { top: number; column: string }>());

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const cards = board.querySelectorAll<HTMLElement>("article[data-application-id]");
    const reduced = motionIsCurrentlyOff();
    if (!reduced) {
      const motion = getComputedStyle(document.documentElement);
      const duration = Number.parseFloat(motion.getPropertyValue("--motion-standard")) || 190;
      const easing = motion.getPropertyValue("--motion-ease").trim();
      cards.forEach((card) => {
        const before = beforeUpdate.current.get(card.dataset.applicationId ?? "");
        const column = card.closest<HTMLElement>("[data-board-status]")?.dataset.boardStatus;
        if (!before || before.column !== column) return;
        const shift = before.top - card.getBoundingClientRect().top;
        if (Math.abs(shift) < 1) return;
        card.animate(
          [{ transform: `translate3d(0, ${shift}px, 0)` }, { transform: "none" }],
          { duration, easing },
        );
      });
    }
    return () => {
      const positions = new Map<string, { top: number; column: string }>();
      board.querySelectorAll<HTMLElement>("article[data-application-id]").forEach((card) => {
        const id = card.dataset.applicationId;
        const column = card.closest<HTMLElement>("[data-board-status]")?.dataset.boardStatus;
        if (id && column) positions.set(id, { top: card.getBoundingClientRect().top, column });
      });
      beforeUpdate.current = positions;
    };
  }, [applications, boards]);

  return (
    <div ref={boardRef} className="board-columns flex h-full min-h-0 w-full items-stretch gap-4" aria-label="Application status board">
      {boards.map((board) => {
        const items = applications.filter((application) => !application.archived && application.status === board.status);
        return <KanbanColumn key={board.status} board={board} applications={items} dropDisabled={dropDisabled} movingIds={movingIds} emptyText={emptyText ?? board.emptyText} card={{ today, staleDays, onOpen }} />;
      })}
    </div>
  );
}

function KanbanColumn({ board, applications, dropDisabled, movingIds, emptyText, card }: {
  board: BoardConfiguration;
  applications: ApplicationRecord[];
  dropDisabled: boolean;
  movingIds: ReadonlySet<string>;
  emptyText: string;
  card: CardContext;
}) {
  const scrollRef = useScrollbarActivity<HTMLDivElement>();
  const { isOver, setNodeRef } = useDroppable({ id: board.status, disabled: dropDisabled });
  return (
    <section ref={setNodeRef} data-board-status={board.status} className={`motion-surface kanban-column flex h-full min-h-0 flex-col rounded-nook-lg border p-3 ${isOver ? "border-forest bg-forest-tint" : "border-line bg-cream-2"}`}>
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2 px-1.5 pt-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><span className={`status-dot ${board.dot}`} />{board.label}</h3>
        <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs font-medium text-ink-soft">{applications.length}</span>
      </div>
      <div ref={scrollRef} className="kanban-column-scroll scrollbar-styled min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
        <div className="flex flex-col gap-2.5">
        {applications.map((application) => (
          <KanbanCard key={application.id} application={application} disabled={movingIds.has(application.id)} {...card} />
        ))}
        {applications.length === 0 && (
          <p className="mt-1 rounded-nook border border-dashed border-line px-3 py-5 text-center text-xs leading-5 text-ink-soft">
            {emptyText}
          </p>
        )}
        </div>
      </div>
    </section>
  );
}

function KanbanCard({ application, disabled, today, staleDays, onOpen }: {
  application: ApplicationRecord;
  disabled: boolean;
} & CardContext) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    data: { applicationId: application.id, label: `${application.role} at ${application.company}`, source: "board", status: application.status },
    disabled,
  });
  const datesId = useId();
  const stale = staleDays.get(application.id);
  const interview = application.status === Status.INTERVIEW ? featuredInterview(application.interviews, today) : undefined;
  const followUpDue = Boolean(today && application.followUpDate && application.followUpDate.slice(0, 10) <= today);
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
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`card kanban-card-focus relative touch-none cursor-grab p-3.5 active:cursor-grabbing ${isDragging ? "opacity-0" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        className="kanban-card-action absolute inset-0 z-0 cursor-grab rounded-nook focus-visible:outline-none active:cursor-grabbing"
        data-kanban-card-id={application.id}
        onClick={() => { if (!disabled && !isDragging) onOpen(application); }}
        type="button"
        {...attributes}
        {...listeners}
        aria-describedby={`${datesId} ${attributes["aria-describedby"]}`}
        aria-label={`Open or move ${application.role} at ${application.company}`}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !disabled && !isDragging) { event.preventDefault(); onOpen(application); }
          else listeners?.onKeyDown?.(event);
        }}
      />
      <h4 className="truncate font-serif text-[15px] font-semibold">{application.role}</h4>
      <p className={`mb-2 mt-0.5 text-[13px] text-ink-soft ${postingUrl ? "flex items-center gap-1" : "truncate"}`}>
        {postingUrl ? <span className="min-w-0 truncate">{application.company}</span> : application.company}
        {postingUrl && (
          <a
            aria-label="Open job posting in a new tab"
            className="relative z-10 inline-flex shrink-0 text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
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
      <div id={datesId}>
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className="sr-only">Applied </span>
          {formatCalendarDate(application.appliedDate)}
          {today && <span aria-hidden="true">·</span>}
          {today && <span>{formatDaysAgo(application.appliedDate, today)}</span>}
        </div>
        {interview && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="3" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Interview {formatCalendarDate(interview.date)}{interview.time && `, ${formatInterviewTime(interview.time)}`} · {INTERVIEW_TYPE_LABELS[interview.type]}
          </div>
        )}
        {application.followUpDate && (
          <div className={`mt-1.5 flex items-center gap-1.5 text-[11.5px] ${followUpDue ? "font-medium text-clay" : "text-ink-soft"}`}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
            {followUpDue ? "Follow up due" : "Follow up"} {formatCalendarDate(application.followUpDate)}
          </div>
        )}
        {(application.source?.trim() || stale !== undefined) && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-4">
            {application.source?.trim() && (
              <span className="min-w-0 max-w-full truncate rounded-full border border-line bg-cream px-2 py-0.5 text-ink-soft"><span className="sr-only">Source: </span>{application.source.trim()}</span>
            )}
            {stale !== undefined && (
              <span className="shrink-0 rounded-full bg-clay-tint px-2 py-0.5 font-medium text-ink" title="No status update for a while">Stale · {stale}d</span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function KanbanCardOverlay({ application }: { application: ApplicationRecord }) {
  return (
    <div className="card w-[272px] border-forest p-3.5 shadow-nook-lift">
      <p className="font-serif text-[15px] font-semibold">{application.role}</p>
      <p className="mt-0.5 text-[13px] text-ink-soft">{application.company}</p>
    </div>
  );
}
