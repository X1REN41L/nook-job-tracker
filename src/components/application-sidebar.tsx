"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Status } from "@prisma/client";
import Link from "next/link";
import { Archive, CalendarClock, Columns3, LayoutDashboard, Settings } from "lucide-react";
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import { boardDot, type BoardConfiguration } from "@/lib/board-preferences";
import { ARCHIVED_DROP_ID, SIDEBAR_EDGE_DROP_ID } from "@/hooks/use-board-drag";
import { formatAppliedDate } from "@/lib/application-date";
import type { ApplicationRecord } from "@/types/application";

type ApplicationSidebarProps = {
  boards: BoardConfiguration[];
  sidebarItems: ApplicationRecord[];
  recentItems: ApplicationRecord[];
  archivedItems: ApplicationRecord[];
  totalApplications: number;
  upcomingInterviewCount: number;
  collapsed: boolean;
  width: number;
  page: "job-board" | "dashboard" | "interviews";
  archivedExpanded: boolean;
  allApplicationsExpanded: boolean;
  movingId: string | null;
  searchTerm: string;
  activeFilter: "all" | Status;
  headingRef: RefObject<HTMLHeadingElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
  onSearchTermChange: (value: string) => void;
  onFilterChange: (filter: "all" | Status) => void;
  onToggleSidebar: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  onToggleArchived: () => void;
  onToggleAllApplications: () => void;
  onEdit: (application: ApplicationRecord) => void;
  onRequestDelete: (application: ApplicationRecord, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationRecord) => Promise<void>;
};

const mainNavItemClass = "box-border flex h-9 w-full min-w-0 cursor-pointer items-center gap-3 rounded-nook-sm px-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest [&>svg]:shrink-0 [&>span:first-of-type]:min-w-0 [&>span:first-of-type]:truncate";

export function ApplicationSidebar({
  boards,
  sidebarItems,
  recentItems,
  archivedItems,
  totalApplications,
  upcomingInterviewCount,
  collapsed,
  width,
  page,
  archivedExpanded,
  allApplicationsExpanded,
  movingId,
  searchTerm,
  activeFilter,
  headingRef,
  searchInputRef,
  settingsTriggerRef,
  onSearchTermChange,
  onFilterChange,
  onToggleSidebar,
  onResizePointerDown,
  onResizeKeyDown,
  onOpenArchive,
  onOpenSettings,
  onToggleArchived,
  onToggleAllApplications,
  onEdit,
  onRequestDelete,
  onRestore,
}: ApplicationSidebarProps) {
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const pendingToggleFocusRef = useRef<boolean | null>(null);
  const allApplicationsContentId = useId();
  const allApplicationsHeadingId = useId();
  const activeApplicationsCount = totalApplications - archivedItems.length;
  const allApplicationsSectionClassName = allApplicationsExpanded
    ? archivedExpanded ? "min-h-0 flex flex-col flex-[65_1_0%]" : "min-h-0 flex flex-col flex-1"
    : `shrink-0 ${archivedExpanded ? "" : "mt-auto"}`;
  const archivedSectionClassName = archivedExpanded
    ? allApplicationsExpanded ? "min-h-0 flex-[35_1_0%]" : "min-h-0 flex-1"
    : "shrink-0";

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

  function handleToggleSidebar() {
    pendingToggleFocusRef.current = !collapsed;
    onToggleSidebar();
  }

  return (
        <aside className="sidebar-panel flex h-full min-h-0 flex-col overflow-hidden border-r border-line bg-paper shadow-nook md:shadow-none">
          {!collapsed && (
            <div
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemax={420}
              aria-valuemin={304}
              aria-valuenow={width}
              aria-valuetext={`${width} pixels`}
              className="sidebar-resize-handle"
              onKeyDown={onResizeKeyDown}
              onPointerDown={onResizePointerDown}
              role="separator"
              tabIndex={0}
            />
          )}
          <SidebarEdgeRail
            archivedCount={archivedItems.length}
            collapsed={collapsed}
            onRailPointerDown={onResizePointerDown}
            onOpenArchive={onOpenArchive}
            onOpenSettings={onOpenSettings}
            onToggle={handleToggleSidebar}
            page={page}
            settingsTriggerRef={settingsTriggerRef}
            toggleButtonRef={expandButtonRef}
          />

          <div className="sidebar-content flex h-full min-h-0 flex-col" inert={collapsed}>
          <div className="sidebar-brand-row flex shrink-0 items-center gap-3 py-4">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-forest to-forest-deep font-serif text-lg leading-none text-cream">
              N
            </span>
            <p className="min-w-0 flex-1 font-serif text-base font-semibold leading-tight tracking-tight">Nook</p>
            <button
              ref={collapseButtonRef}
              aria-label="Collapse sidebar"
              className="icon-btn h-8 w-8 shrink-0"
              onClick={handleToggleSidebar}
              type="button"
            >
              <PanelChevron direction="left" />
            </button>
          </div>

          <nav aria-label="Main navigation" className="sidebar-main-nav shrink-0 border-b border-line py-3">
            <div className="flex flex-col gap-1">
              <Link
                aria-current={page === "dashboard" ? "page" : undefined}
                className={`${mainNavItemClass} ${page === "dashboard" ? "bg-forest font-semibold text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
                href="/dashboard"
              >
                <LayoutDashboard aria-hidden="true" size={17} strokeWidth={1.8} />
                <span>Dashboard</span>
              </Link>
              <Link
                aria-current={page === "job-board" ? "page" : undefined}
                className={`${mainNavItemClass} ${page === "job-board" ? "bg-forest font-semibold text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
                href="/jobs"
              >
                <Columns3 aria-hidden="true" size={17} strokeWidth={1.8} />
                <span>Job Board</span>
              </Link>
              <Link
                aria-current={page === "interviews" ? "page" : undefined}
                className={`${mainNavItemClass} ${page === "interviews" ? "bg-forest font-semibold text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
                href="/interviews"
              >
                <CalendarClock aria-hidden="true" size={17} strokeWidth={1.8} />
                <span className="min-w-0 flex-1">Interviews</span>
                <span
                  aria-hidden="true"
                  className="ml-auto min-w-5 rounded-full border border-line bg-cream px-1.5 py-0.5 text-center text-[11px] font-medium leading-none text-ink-soft"
                  data-testid="upcoming-interview-count"
                >
                  {upcomingInterviewCount}
                </span>
              </Link>
              <button
                ref={!collapsed ? settingsTriggerRef : undefined}
                aria-label="Settings"
                className={`${mainNavItemClass} text-left text-ink-soft hover:bg-cream-2 hover:text-ink`}
                onClick={onOpenSettings}
                type="button"
              >
                <Settings aria-hidden="true" size={17} strokeWidth={1.8} />
                <span>Settings</span>
              </button>
            </div>
          </nav>

          {page === "job-board" && (
            <>
              <div className={allApplicationsSectionClassName}>
                <div className={`shrink-0 px-4.5 ${allApplicationsExpanded ? "pt-4" : "border-b border-line py-3"}`}>
                  <h2 aria-label="All applications" className="font-serif text-base font-semibold outline-none" id={allApplicationsHeadingId} ref={headingRef} tabIndex={-1}>
                    <button
                      aria-controls={allApplicationsContentId}
                      aria-expanded={allApplicationsExpanded}
                      className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
                      onClick={onToggleAllApplications}
                      type="button"
                    >
                      <span>All applications</span>
                      <span className="rounded-full border border-line bg-cream px-2 py-0.5 font-sans text-xs font-medium text-ink-soft">
                        {activeApplicationsCount}
                      </span>
                      <svg
                        aria-hidden="true"
                        className={`ml-auto text-ink-soft transition-transform ${allApplicationsExpanded ? "rotate-180" : ""}`}
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
                  </h2>
                </div>

                <section
                  aria-labelledby={allApplicationsHeadingId}
                  className={allApplicationsExpanded ? "min-h-0 flex flex-1 flex-col" : "hidden"}
                  id={allApplicationsContentId}
                >
                  <div className="shrink-0 border-b border-line px-4.5 pb-4 pt-2.5">
                    <div className="relative">
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
                        className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${activeFilter === "all" ? "border-forest bg-forest text-cream" : "border-line bg-cream text-ink-soft hover:bg-cream-2"}`}
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
                          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${activeFilter === board.status ? "border-forest bg-forest text-cream" : "border-line bg-cream text-ink-soft hover:bg-cream-2"}`}
                          onClick={() => onFilterChange(board.status)}
                          tabIndex={0}
                          type="button"
                        >
                          <span className={`status-dot ${boardDot(boards, board.status)} ${activeFilter === board.status ? "ring-1 ring-cream" : ""}`} />{board.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="scrollbar-styled min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
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
                </section>
              </div>

              {!collapsed && (
                <ArchivedSection
                  boards={boards}
                  applications={archivedItems}
                  className={archivedSectionClassName}
                  expanded={archivedExpanded}
                  movingId={movingId}
                  onEdit={onEdit}
                  onRequestDelete={onRequestDelete}
                  onRestore={onRestore}
                  onToggle={onToggleArchived}
                />
              )}

            </>
          )}

          {page === "dashboard" && !collapsed && (
            <section className="flex min-h-0 flex-1 flex-col px-3 py-4" aria-labelledby="recent-applications-heading">
              <h2 id="recent-applications-heading" className="shrink-0 px-2 font-serif text-base font-semibold">
                Recent applications
              </h2>
              <div className="scrollbar-styled mt-2 min-h-0 flex-1 overflow-y-auto">
                {recentItems.length === 0 ? (
                  <p className="px-3 py-10 text-center text-sm leading-6 text-ink-soft">No recent applications yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {recentItems.map((application) => (
                      <SidebarApplicationRow
                        key={application.id}
                        application={application}
                        boards={boards}
                        disabled={movingId !== null}
                        draggable={false}
                        onEdit={onEdit}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
          </div>
        </aside>
  );
}

function SidebarApplicationRow({ application, boards, disabled, draggable = true, onEdit }: {
  application: ApplicationRecord;
  boards: BoardConfiguration[];
  disabled: boolean;
  draggable?: boolean;
  onEdit: (application: ApplicationRecord) => void;
}) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sidebar:${application.id}`,
    data: { applicationId: application.id, label: `${application.role} at ${application.company}`, source: "sidebar" },
    disabled: disabled || !draggable,
  });

  return (
    <button
      ref={setNodeRef}
      data-application-id={application.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`flex w-full items-center gap-2.5 rounded-nook-sm px-2.5 py-2 text-left transition hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest ${draggable ? "touch-none cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isDragging ? "opacity-0 transition-none" : ""}`}
      onClick={() => { if (!disabled && !isDragging) onEdit(application); }}
      type="button"
      {...(draggable ? listeners : {})}
      aria-label={`${draggable ? "Edit or archive" : "Edit"} ${application.role} at ${application.company}`}
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

function ArchivedSection({ applications, boards, className, expanded, movingId, onEdit, onRequestDelete, onRestore, onToggle }: {
  applications: ApplicationRecord[];
  boards: BoardConfiguration[];
  className: string;
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
      className={`${className} flex min-h-0 flex-col border-t border-line transition-colors ${isOver ? "bg-forest-tint ring-2 ring-inset ring-forest" : "bg-paper"}`}
    >
      <div className="shrink-0">
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
        <div className="scrollbar-styled min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2" id={contentId}>
          {applications.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs leading-5 text-ink-soft">No archived applications.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
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
        className="flex w-full touch-none cursor-grab items-center gap-2.5 px-2.5 py-1 text-left active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
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
      <div className="flex justify-end gap-2 px-2.5 pb-1">
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

function SidebarEdgeRail({
  archivedCount,
  collapsed,
  onRailPointerDown,
  onOpenArchive,
  onOpenSettings,
  onToggle,
  page,
  settingsTriggerRef,
  toggleButtonRef,
}: {
  archivedCount: number;
  collapsed: boolean;
  onRailPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  onToggle: () => void;
  page: "job-board" | "dashboard" | "interviews";
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
  toggleButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: SIDEBAR_EDGE_DROP_ID, disabled: !collapsed || page !== "job-board" });

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-edge-rail absolute inset-y-0 left-0 z-10 w-[var(--sidebar-rail-width)] transition-colors ${isOver ? "bg-forest-tint ring-2 ring-inset ring-forest" : ""}`}
      inert={!collapsed}
      onPointerDown={(event) => {
        if (collapsed && event.target === event.currentTarget) onRailPointerDown(event);
      }}
    >
      <button
        ref={toggleButtonRef}
        aria-label="Expand sidebar"
        className="sidebar-edge-tab pointer-events-auto absolute left-1/2 top-4 flex h-10 w-10 -translate-x-1/2 items-center justify-center font-serif text-xl leading-none text-cream shadow-nook focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true" className="sidebar-logo-mark">N</span>
        <span aria-hidden="true" className="sidebar-expand-mark">
          <PanelChevron direction="right" size={19} />
        </span>
      </button>
      {collapsed && (
        <nav aria-label="Main navigation" className="absolute left-1/2 top-20 flex -translate-x-1/2 flex-col gap-1">
          <Link
            aria-current={page === "dashboard" ? "page" : undefined}
            aria-label="Dashboard"
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-nook-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${page === "dashboard" ? "bg-forest text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
            href="/dashboard"
            title="Dashboard"
          >
            <LayoutDashboard aria-hidden="true" size={19} strokeWidth={1.8} />
          </Link>
          <Link
            aria-current={page === "job-board" ? "page" : undefined}
            aria-label="Job Board"
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-nook-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${page === "job-board" ? "bg-forest text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
            href="/jobs"
            title="Job Board"
          >
            <Columns3 aria-hidden="true" size={19} strokeWidth={1.8} />
          </Link>
          <Link
            aria-current={page === "interviews" ? "page" : undefined}
            aria-label="Interviews"
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-nook-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${page === "interviews" ? "bg-forest text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink"}`}
            href="/interviews"
            title="Interviews"
          >
            <CalendarClock aria-hidden="true" size={19} strokeWidth={1.8} />
          </Link>
          <button
            ref={settingsTriggerRef}
            aria-label="Settings"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-nook-sm text-ink-soft transition hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
            onClick={onOpenSettings}
            title="Settings"
            type="button"
          >
            <Settings aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </nav>
      )}
      {collapsed && page === "job-board" && (
        <SidebarArchiveRailButton archivedCount={archivedCount} isOver={isOver} onOpenArchive={onOpenArchive} />
      )}
      {collapsed && page === "job-board" && isOver && (
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-14 w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-nook-sm border border-forest bg-paper text-[9px] font-semibold leading-tight text-forest-deep shadow-nook">
          <Archive size={19} strokeWidth={1.8} />
          <span>Archive</span>
        </div>
      )}
    </div>
  );
}

function SidebarArchiveRailButton({ archivedCount, isOver, onOpenArchive }: { archivedCount: number; isOver: boolean; onOpenArchive: () => void }) {
  return (
    <button
      aria-label={`Open Archive, ${archivedCount} archived`}
      className={`absolute bottom-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-nook-sm text-ink-soft transition hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${isOver ? "bg-forest-tint text-forest-deep ring-2 ring-forest" : ""}`}
      data-testid="collapsed-archive-button"
      onClick={onOpenArchive}
      title={`Archive (${archivedCount})`}
      type="button"
    >
      <Archive aria-hidden="true" size={19} strokeWidth={1.8} />
      <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full border border-line bg-paper px-1 text-center text-[9px] leading-4 text-ink">
        {archivedCount}
      </span>
    </button>
  );
}

function PanelChevron({ direction, size = 17 }: { direction: "left" | "right"; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
      <polyline points={direction === "right" ? "9 9 12 12 9 15" : "11 9 8 12 11 15"} />
    </svg>
  );
}
