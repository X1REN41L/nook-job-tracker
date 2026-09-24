"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Status } from "@prisma/client";
import { useId, useLayoutEffect, useRef, type MouseEvent, type RefObject } from "react";

import { boardDot, type BoardConfiguration } from "@/lib/board-preferences";
import { ARCHIVED_DROP_ID, SIDEBAR_EDGE_DROP_ID } from "@/hooks/use-board-drag";
import { formatAppliedDate } from "@/lib/application-date";
import type { ApplicationRecord } from "@/types/application";

type ApplicationSidebarProps = {
  boards: BoardConfiguration[];
  sidebarItems: ApplicationRecord[];
  archivedItems: ApplicationRecord[];
  totalApplications: number;
  collapsed: boolean;
  archivedExpanded: boolean;
  movingId: string | null;
  searchTerm: string;
  activeFilter: "all" | Status;
  headingRef: RefObject<HTMLHeadingElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchTermChange: (value: string) => void;
  onFilterChange: (filter: "all" | Status) => void;
  onToggleSidebar: () => void;
  onToggleArchived: () => void;
  onEdit: (application: ApplicationRecord) => void;
  onRequestDelete: (application: ApplicationRecord, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationRecord) => Promise<void>;
};

export function ApplicationSidebar({
  boards,
  sidebarItems,
  archivedItems,
  totalApplications,
  collapsed,
  archivedExpanded,
  movingId,
  searchTerm,
  activeFilter,
  headingRef,
  searchInputRef,
  onSearchTermChange,
  onFilterChange,
  onToggleSidebar,
  onToggleArchived,
  onEdit,
  onRequestDelete,
  onRestore,
}: ApplicationSidebarProps) {
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const pendingToggleFocusRef = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    if (pendingToggleFocusRef.current !== collapsed) return;
    const button = (collapsed ? expandButtonRef : collapseButtonRef).current;
    if (!button) return;

    const focusWhenVisible = () => {
      if (getComputedStyle(button).visibility !== "visible") return;
      pendingToggleFocusRef.current = null;
      button.focus({ preventScroll: true });
    };

    focusWhenVisible();
    if (pendingToggleFocusRef.current !== collapsed) return;

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === "visibility") focusWhenVisible();
    };
    button.addEventListener("transitionend", handleTransitionEnd);
    return () => button.removeEventListener("transitionend", handleTransitionEnd);
  }, [collapsed]);

  function handleToggleSidebar(event: MouseEvent<HTMLButtonElement>) {
    pendingToggleFocusRef.current = event.detail === 0 ? !collapsed : null;
    onToggleSidebar();
  }

  return (
        <aside className="sidebar-panel flex h-full min-h-0 flex-col overflow-hidden border-l border-line bg-paper shadow-nook md:shadow-none">
          <SidebarEdgeRail collapsed={collapsed} onToggle={handleToggleSidebar} toggleButtonRef={expandButtonRef} />

          <div className="sidebar-content flex h-full min-h-0 flex-col" inert={collapsed}>
          <div className="shrink-0 border-b border-line px-4.5 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-base font-semibold outline-none" ref={headingRef} tabIndex={-1}>
                All applications
              </h2>
              <button
                ref={collapseButtonRef}
                aria-label="Collapse sidebar"
                className="icon-btn h-8 w-8 shrink-0"
                onClick={handleToggleSidebar}
                type="button"
              >
                <PanelChevron direction="right" />
              </button>
            </div>
            <div className="relative mt-2.5">
              <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                aria-label="Search company or role"
                className="input pl-9 text-sm"
                onChange={(e) => onSearchTermChange(e.target.value)}
                placeholder="Search company or role…"
                type="text"
                value={searchTerm}
              />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                aria-pressed={activeFilter === "all"}
                className={`rounded-full border px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${activeFilter === "all" ? "border-forest bg-forest text-cream" : "border-line bg-cream text-ink-soft hover:bg-cream-2"}`}
                onClick={() => onFilterChange("all")}
                tabIndex={0}
                type="button"
              >
                All
              </button>
              {boards.map((board) => (
                <button
                  key={board.status}
                  aria-pressed={activeFilter === board.status}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${activeFilter === board.status ? "border-forest bg-forest text-cream" : "border-line bg-cream text-ink-soft hover:bg-cream-2"}`}
                  onClick={() => onFilterChange(board.status)}
                  tabIndex={0}
                  type="button"
                >
                  <span className={`status-dot ${boardDot(boards, board.status)} ${activeFilter === board.status ? "ring-1 ring-cream" : ""}`} />{board.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {sidebarItems.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm leading-6 text-ink-soft">
                {totalApplications === 0 ? "No applications yet. Add your first job to see it here." : "No applications match your search."}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {sidebarItems.map((application) => (
                  <SidebarApplicationRow
                    key={application.id}
                    application={application}
                    boards={boards}
                    disabled={movingId !== null}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            )}
          </div>

          <ArchivedSection
            boards={boards}
            applications={archivedItems}
            expanded={archivedExpanded}
            movingId={movingId}
            onEdit={onEdit}
            onRequestDelete={onRequestDelete}
            onRestore={onRestore}
            onToggle={onToggleArchived}
          />

          <div className="shrink-0 border-t border-line px-4.5 py-2.5 text-xs text-ink-soft">
            {totalApplications} {totalApplications === 1 ? "application" : "applications"} total
          </div>
          </div>
        </aside>
  );
}

function SidebarApplicationRow({ application, boards, disabled, onEdit }: {
  application: ApplicationRecord;
  boards: BoardConfiguration[];
  disabled: boolean;
  onEdit: (application: ApplicationRecord) => void;
}) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sidebar:${application.id}`,
    data: { applicationId: application.id, label: `${application.role} at ${application.company}`, source: "sidebar" },
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      data-application-id={application.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`flex w-full touch-none cursor-grab items-center gap-2.5 rounded-nook-sm px-2.5 py-2 text-left transition hover:bg-cream-2 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest ${isDragging ? "opacity-0 transition-none" : ""}`}
      onClick={() => { if (!disabled && !isDragging) onEdit(application); }}
      type="button"
      {...listeners}
      aria-label={`Edit or archive ${application.role} at ${application.company}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !disabled && !isDragging) { event.preventDefault(); onEdit(application); }
      }}
    >
      <span className={`status-dot ${boardDot(boards, application.status)}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{application.role}</span>
        <span className="block truncate text-xs text-ink-soft">{application.company}</span>
      </span>
      <span className="shrink-0 text-xs text-ink-soft">{formatAppliedDate(application.appliedDate)}</span>
    </button>
  );
}

function ArchivedSection({ applications, boards, expanded, movingId, onEdit, onRequestDelete, onRestore, onToggle }: {
  applications: ApplicationRecord[];
  boards: BoardConfiguration[];
  expanded: boolean;
  movingId: string | null;
  onEdit: (application: ApplicationRecord) => void;
  onRequestDelete: (application: ApplicationRecord, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationRecord) => Promise<void>;
  onToggle: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: ARCHIVED_DROP_ID });
  const contentId = useId();

  return (
    <section
      ref={setNodeRef}
      className={`shrink-0 border-t border-line transition-colors ${isOver ? "bg-forest-tint ring-2 ring-inset ring-forest" : "bg-paper"}`}
    >
      <div>
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-4.5 py-3 text-left transition hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
          onClick={onToggle}
          type="button"
        >
          <span className="font-serif text-sm font-semibold">Archived</span>
          <span className="rounded-full border border-line bg-cream px-2 py-0.5 text-xs font-medium text-ink-soft">
            {applications.length}
          </span>
          <svg
            aria-hidden="true"
            className={`ml-auto text-ink-soft transition-transform ${expanded ? "rotate-180" : ""}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="max-h-[40vh] overflow-y-auto px-3 py-2" id={contentId}>
          {applications.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs leading-5 text-ink-soft">No archived applications.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {applications.map((application) => (
                <ArchivedRow
                  boards={boards}
                  key={application.id}
                  application={application}
                  disabled={movingId !== null}
                  onEdit={onEdit}
                  onRequestDelete={onRequestDelete}
                  onRestore={onRestore}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ArchivedRow({ application, boards, disabled, onEdit, onRequestDelete, onRestore }: {
  application: ApplicationRecord;
  boards: BoardConfiguration[];
  disabled: boolean;
  onEdit: (application: ApplicationRecord) => void;
  onRequestDelete: (application: ApplicationRecord, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationRecord) => Promise<void>;
}) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    data: { applicationId: application.id, label: `${application.role} at ${application.company}`, source: "archived" },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-application-id={application.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-nook-sm transition hover:bg-cream-2 ${isDragging ? "opacity-0 transition-none" : ""}`}
    >
      <button
        className="flex w-full touch-none cursor-grab items-center gap-2.5 px-2.5 pb-1 pt-2 text-left active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
        onClick={() => { if (!disabled && !isDragging) onEdit(application); }}
        type="button"
        {...listeners}
        aria-label={`Edit or move archived ${application.role} at ${application.company}`}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !disabled && !isDragging) { event.preventDefault(); onEdit(application); }
        }}
      >
        <span className={`status-dot ${boardDot(boards, application.status)}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{application.role}</span>
          <span className="block truncate text-xs text-ink-soft">{application.company}</span>
        </span>
        <span className="shrink-0 text-xs text-ink-soft">{formatAppliedDate(application.appliedDate)}</span>
      </button>
      <div className="flex justify-end gap-2 px-2.5 pb-2">
        <button
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-forest transition hover:text-forest-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:opacity-50"
          disabled={disabled}
          onClick={() => void onRestore(application)}
          type="button"
        >
          Restore
        </button>
        <button
          aria-label={`Delete ${application.role} at ${application.company}`}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-rose transition hover:bg-rose-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose disabled:opacity-50"
          disabled={disabled}
          onClick={(event) => onRequestDelete(application, event.currentTarget)}
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function SidebarEdgeRail({ collapsed, onToggle, toggleButtonRef }: { collapsed: boolean; onToggle: (event: MouseEvent<HTMLButtonElement>) => void; toggleButtonRef: RefObject<HTMLButtonElement | null> }) {
  const { setNodeRef } = useDroppable({ id: SIDEBAR_EDGE_DROP_ID, disabled: !collapsed });

  return (
    <div ref={setNodeRef} className="sidebar-edge-rail absolute inset-y-0 left-0 z-10 w-10" inert={!collapsed}>
      <button
        ref={toggleButtonRef}
        aria-label="Show all applications"
        className="sidebar-edge-tab icon-btn pointer-events-auto absolute left-0 top-4 rounded-l-none border-l-0"
        onClick={onToggle}
        type="button"
      >
        <PanelChevron direction="left" />
      </button>
    </div>
  );
}

function PanelChevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
      <polyline points={direction === "right" ? "9 9 12 12 9 15" : "11 9 8 12 11 15"} />
    </svg>
  );
}
