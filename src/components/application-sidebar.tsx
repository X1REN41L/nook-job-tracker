"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { Archive, CalendarClock, ChartNoAxesCombined, Columns3, LayoutDashboard, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings, Table2, type LucideIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import { boardDot, type BoardConfiguration } from "@/lib/board-preferences";
import { ARCHIVED_DROP_ID, SIDEBAR_EDGE_DROP_ID } from "@/hooks/use-board-drag";
import { formatCalendarDate } from "@/lib/application-date";
import type { ApplicationSummary } from "@/types/application";
import type { ApplicationPageName, DashboardSection } from "@/types/navigation";

type ApplicationSidebarProps = {
  boards: BoardConfiguration[];
  archivedItems: ApplicationSummary[];
  /** Null until the browser's clock is known. */
  upcomingInterviewCount: number | null;
  collapsed: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  page: ApplicationPageName;
  dashboardSection?: DashboardSection;
  archivedExpanded: boolean;
  movingIds: ReadonlySet<string>;
  /** Days since activity for stale applications, archived ones included. */
  staleDays: ReadonlyMap<string, number>;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
  focusExpandOnCollapseRef: RefObject<boolean>;
  onToggleSidebar: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  onToggleArchived: () => void;
  onOpen: (application: ApplicationSummary) => void;
  onRequestDelete: (application: ApplicationSummary, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationSummary) => Promise<void>;
};

const navRowClass = "box-border flex h-9 w-full min-w-0 shrink-0 cursor-pointer items-center rounded-nook-sm text-left text-sm motion-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";
const mainNavItemClass = `sidebar-nav-row ${navRowClass} p-0`;
/** Every sidebar glyph shares one size and stroke so the rail reads as a single set. */
const NAV_ICON_SIZE = 18;
const NAV_ICON_STROKE = 1.75;

function navItemStateClass(active: boolean) {
  return active ? "bg-forest font-semibold text-cream" : "text-ink-soft hover:bg-cream-2 hover:text-ink";
}

/** Section links under a page (Overview, Analytics) mark their selection with an outline, so the page tile stays the only solid one. */
function subNavItemStateClass(active: boolean) {
  return active ? "font-semibold text-forest ring-1 ring-inset ring-forest" : "text-ink-soft hover:bg-cream-2 hover:text-ink";
}

function MainNavIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
      <Icon className="shrink-0" size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
    </span>
  );
}

export function ApplicationSidebar({
  boards,
  archivedItems,
  upcomingInterviewCount,
  collapsed,
  width,
  minWidth,
  maxWidth,
  page,
  dashboardSection = "overview",
  archivedExpanded,
  movingIds,
  staleDays,
  settingsTriggerRef,
  focusExpandOnCollapseRef,
  onToggleSidebar,
  onResizePointerDown,
  onResizeKeyDown,
  onOpenArchive,
  onOpenSettings,
  onToggleArchived,
  onOpen,
  onRequestDelete,
  onRestore,
}: ApplicationSidebarProps) {
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const pendingToggleFocusRef = useRef<boolean | null>(null);
  const archivedSectionClassName = `sidebar-flex-section sidebar-archive-section mt-auto ${archivedExpanded ? "is-expanded" : ""}`;

  useLayoutEffect(() => {
    if (collapsed && focusExpandOnCollapseRef.current) {
      pendingToggleFocusRef.current = true;
      focusExpandOnCollapseRef.current = false;
    }
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
  }, [collapsed, focusExpandOnCollapseRef]);

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
              aria-valuemax={maxWidth}
              aria-valuemin={minWidth}
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
            page={page}
          />

          <div className="sidebar-brand-row relative z-10 flex shrink-0 items-center py-4">
            <button
              ref={expandButtonRef}
              aria-label="Expand sidebar"
              className="sidebar-logo-button absolute top-4 z-10 flex h-9 w-9 items-center justify-center rounded-[10px] text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              onClick={handleToggleSidebar}
              title="Expand sidebar"
              type="button"
            >
              <PanelLeftOpen aria-hidden="true" size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
            </button>
            <span aria-hidden="true" className="sidebar-brand-logo flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-forest to-forest-deep font-serif text-lg leading-none text-cream">
              <span className="sidebar-brand-initial">N</span>
            </span>
            <div className="sidebar-reveal sidebar-brand-text ml-3 flex min-w-0 flex-1 items-baseline gap-2.5">
              <p className="shrink-0 whitespace-nowrap font-serif text-base font-semibold leading-tight tracking-tight">Nook</p>
              <p className="min-w-0 truncate text-xs text-ink-soft">your job search, kept tidy</p>
            </div>
            <button
              ref={collapseButtonRef}
              aria-label="Collapse sidebar"
              className="sidebar-header-toggle icon-btn absolute h-8 w-8"
              onClick={handleToggleSidebar}
              type="button"
            >
              <PanelLeftClose aria-hidden="true" size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
            </button>
          </div>

          <nav aria-label="Main navigation" className="sidebar-main-nav sidebar-nav-divider relative z-10 shrink-0 py-3">
            <div className="flex flex-col gap-1">
              <Link
                aria-current={page === "dashboard" ? "page" : undefined}
                aria-label="Dashboard"
                className={`${mainNavItemClass} ${navItemStateClass(page === "dashboard")}`}
                href="/dashboard"
                title={collapsed ? "Dashboard" : undefined}
              >
                <span className="sidebar-nav-icon"><MainNavIcon Icon={LayoutDashboard} /></span>
                <span className="sidebar-reveal ml-3 whitespace-nowrap">Dashboard</span>
              </Link>
              <Link
                aria-current={page === "job-board" ? "page" : undefined}
                aria-label="Job Board"
                className={`${mainNavItemClass} ${navItemStateClass(page === "job-board")}`}
                href="/jobs"
                title={collapsed ? "Job Board" : undefined}
              >
                <span className="sidebar-nav-icon"><MainNavIcon Icon={Columns3} /></span>
                <span className="sidebar-reveal ml-3 whitespace-nowrap">Job Board</span>
              </Link>
              <Link
                aria-current={page === "table" ? "page" : undefined}
                aria-label="Table"
                className={`${mainNavItemClass} ${navItemStateClass(page === "table")}`}
                href="/table"
                title={collapsed ? "Table" : undefined}
              >
                <span className="sidebar-nav-icon"><MainNavIcon Icon={Table2} /></span>
                <span className="sidebar-reveal ml-3 whitespace-nowrap">Table</span>
              </Link>
              <Link
                aria-current={page === "interviews" ? "page" : undefined}
                aria-label={upcomingInterviewCount === null ? "Interviews" : `Interviews, ${upcomingInterviewCount} upcoming`}
                className={`${mainNavItemClass} ${navItemStateClass(page === "interviews")}`}
                href="/interviews"
                title={collapsed ? "Interviews" : undefined}
              >
                <span className="sidebar-nav-icon"><MainNavIcon Icon={CalendarClock} /></span>
                <span className="sidebar-reveal ml-3 whitespace-nowrap">Interviews</span>
                {upcomingInterviewCount !== null && (
                  <span
                    aria-hidden="true"
                    className="sidebar-reveal ml-auto mr-2 min-w-5 rounded-full border border-line bg-cream px-2 py-0.5 text-xs font-medium leading-4 text-center text-ink-soft"
                    data-testid="upcoming-interview-count"
                  >
                    {upcomingInterviewCount}
                  </span>
                )}
              </Link>
              <button
                ref={settingsTriggerRef}
                aria-label="Settings"
                className={`${mainNavItemClass} ${navItemStateClass(false)}`}
                onClick={onOpenSettings}
                title={collapsed ? "Settings" : undefined}
                type="button"
              >
                <span className="sidebar-nav-icon"><MainNavIcon Icon={Settings} /></span>
                <span className="sidebar-reveal ml-3 whitespace-nowrap">Settings</span>
              </button>
            </div>
          </nav>

          <div className={`sidebar-content flex min-h-0 flex-1 flex-col ${page === "dashboard" ? "sidebar-dashboard-content" : ""}`} inert={collapsed && page !== "dashboard"}>

          {page === "job-board" && !collapsed && (
            <ArchivedSection
              boards={boards}
              applications={archivedItems}
              className={archivedSectionClassName}
              expanded={archivedExpanded}
              movingIds={movingIds}
              staleDays={staleDays}
              onOpen={onOpen}
              onRequestDelete={onRequestDelete}
              onRestore={onRestore}
              onToggle={onToggleArchived}
            />
          )}

          {page === "dashboard" && (
            <nav aria-label="Dashboard sections" className="sidebar-main-nav relative z-10 min-h-0 overflow-y-auto py-4">
              {!collapsed && <h2 className="px-[9px] font-serif text-base font-semibold">Dashboard</h2>}
              <div className={`${collapsed ? "" : "mt-2"} flex flex-col gap-1`}>
                {([
                  { section: "overview", label: "Overview", href: "/dashboard", icon: PanelsTopLeft },
                  { section: "analytics", label: "Analytics", href: "/dashboard/analytics", icon: ChartNoAxesCombined },
                ] as const).map(({ section, label, href, icon }) => (
                  <Link
                    key={section}
                    aria-current={dashboardSection === section ? "page" : undefined}
                    aria-label={label}
                    className={`${mainNavItemClass} ${subNavItemStateClass(dashboardSection === section)}`}
                    href={href}
                    title={collapsed ? label : undefined}
                  >
                    <span className="sidebar-nav-icon"><MainNavIcon Icon={icon} /></span>
                    {!collapsed && <span className="ml-3 whitespace-nowrap">{label}</span>}
                  </Link>
                ))}
              </div>
            </nav>
          )}
          </div>
        </aside>
  );
}

function ArchivedSection({ applications, boards, className, expanded, movingIds, staleDays, onOpen, onRequestDelete, onRestore, onToggle }: {
  applications: ApplicationSummary[];
  boards: BoardConfiguration[];
  className: string;
  expanded: boolean;
  movingIds: ReadonlySet<string>;
  staleDays: ReadonlyMap<string, number>;
  onOpen: (application: ApplicationSummary) => void;
  onRequestDelete: (application: ApplicationSummary, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationSummary) => Promise<void>;
  onToggle: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: ARCHIVED_DROP_ID });
  const contentId = useId();

  return (
    <section
      ref={setNodeRef}
      className={`${className} flex min-h-0 flex-col border-t border-line motion-surface ${isOver ? "bg-forest-tint ring-2 ring-inset ring-forest" : "bg-paper"}`}
    >
      <div className="shrink-0">
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-4.5 py-3 text-left motion-interactive hover:bg-cream-2 md:w-[calc(100%-0.375rem)] md:pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
          onClick={onToggle}
          type="button"
        >
          <span className="font-serif text-sm font-semibold">Archived</span>
          <span className="rounded-full border border-line bg-cream px-2 py-0.5 text-xs font-medium leading-4 text-ink-soft">
            {applications.length}
          </span>
          <svg
            aria-hidden="true"
            className={`ml-auto text-ink-soft motion-chevron ${expanded ? "rotate-180" : ""}`}
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

      <div aria-hidden={!expanded} className="sidebar-expandable-body scrollbar-styled min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 md:mr-1.5 md:pr-1.5" id={contentId} inert={!expanded}>
          {applications.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs leading-5 text-ink-soft">No archived applications.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {applications.map((application) => (
                <ArchivedRow
                  boards={boards}
                  key={application.id}
                  application={application}
                  disabled={movingIds.has(application.id)}
                  staleDays={staleDays.get(application.id)}
                  onOpen={onOpen}
                  onRequestDelete={onRequestDelete}
                  onRestore={onRestore}
                />
              ))}
            </div>
          )}
      </div>
    </section>
  );
}

function ArchivedRow({ application, boards, disabled, staleDays, onOpen, onRequestDelete, onRestore }: {
  application: ApplicationSummary;
  boards: BoardConfiguration[];
  disabled: boolean;
  staleDays: number | undefined;
  onOpen: (application: ApplicationSummary) => void;
  onRequestDelete: (application: ApplicationSummary, trigger: HTMLElement) => void;
  onRestore: (application: ApplicationSummary) => Promise<void>;
}) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    data: { applicationId: application.id, label: `${application.role} at ${application.company}`, source: "archived" },
    disabled,
  });

  // One line per row: Restore and Delete take the date's place on hover or keyboard focus.
  return (
    <div
      ref={setNodeRef}
      data-application-id={application.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`group/archived relative rounded-nook-sm motion-interactive hover:bg-cream-2 focus-within:bg-cream-2 ${isDragging ? "opacity-0 transition-none" : ""}`}
    >
      <button
        className="flex w-full touch-none cursor-grab items-center gap-2.5 rounded-nook-sm px-2.5 py-2 text-left active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
        onClick={() => { if (!disabled && !isDragging) onOpen(application); }}
        type="button"
        {...listeners}
        aria-label={`Open archived ${application.role} at ${application.company}`}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !disabled && !isDragging) { event.preventDefault(); onOpen(application); }
        }}
      >
        <span className={`status-dot ${boardDot(boards, application.status)}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{application.role}</span>
          <span className="block truncate text-xs text-ink-soft">{application.company}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-ink-soft motion-interactive group-focus-within/archived:opacity-0 group-hover/archived:opacity-0">
          {formatCalendarDate(application.appliedDate)}
          {staleDays !== undefined && <span className="rounded-full bg-clay-tint px-2 py-0.5 text-[11px] font-medium leading-4 text-ink" title="No status update for a while">Stale · {staleDays}d</span>}
        </span>
      </button>
      <div className="absolute inset-y-1 right-1.5 flex items-center gap-1 rounded-nook-sm bg-cream-2 pl-2 opacity-0 motion-interactive group-focus-within/archived:opacity-100 group-hover/archived:opacity-100">
        <button
          className="rounded-nook-sm px-1.5 py-0.5 text-[11px] font-medium text-forest motion-interactive hover:text-forest-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:opacity-50"
          disabled={disabled}
          onClick={() => void onRestore(application)}
          type="button"
        >
          Restore
        </button>
        <button
          aria-label={`Delete ${application.role} at ${application.company}`}
          className="rounded-nook-sm px-1.5 py-0.5 text-[11px] font-medium text-rose motion-interactive hover:bg-rose-tint hover:text-rose-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose disabled:opacity-50"
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
  page,
}: {
  archivedCount: number;
  collapsed: boolean;
  onRailPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onOpenArchive: () => void;
  page: ApplicationPageName;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: SIDEBAR_EDGE_DROP_ID, disabled: !collapsed || page !== "job-board" });

  return (
    <div
      ref={setNodeRef}
      className={`sidebar-edge-rail absolute inset-y-0 left-0 motion-interactive ${isOver ? "bg-forest-tint ring-2 ring-inset ring-forest" : ""}`}
      inert={!collapsed}
      onPointerDown={(event) => {
        if (collapsed && event.target === event.currentTarget) onRailPointerDown(event);
      }}
    >
      {collapsed && page === "job-board" && (
        <SidebarArchiveRailButton archivedCount={archivedCount} isOver={isOver} onOpenArchive={onOpenArchive} />
      )}
    </div>
  );
}

/** The collapsed rail's Archive button; while a card is dragged over the rail, it moves to the rail's middle to take the drop. */
function SidebarArchiveRailButton({ archivedCount, isOver, onOpenArchive }: { archivedCount: number; isOver: boolean; onOpenArchive: () => void }) {
  return (
    <button
      aria-label={`Open Archive, ${archivedCount} archived`}
      className={`sidebar-archive-rail-button absolute left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-nook-sm text-ink-soft hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest ${isOver ? "bg-forest-tint text-forest-deep ring-2 ring-forest" : ""}`}
      data-drop-target={isOver || undefined}
      data-testid="collapsed-archive-button"
      onClick={onOpenArchive}
      title={`Archive (${archivedCount})`}
      type="button"
    >
      <Archive aria-hidden="true" size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
      <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full border border-line bg-paper px-1 text-center text-[9px] leading-4 text-ink">
        {archivedCount}
      </span>
    </button>
  );
}
