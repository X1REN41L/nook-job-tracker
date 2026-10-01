"use client";

import type { Status } from "@prisma/client";
import { useEffect, useRef, useState, type RefObject } from "react";

import { currentLocalDate, formatCalendarDate, formatDaysAgo } from "@/lib/application-date";
import {
  appliedRangeForPreset, appliedRangePreset, applicationTableHref, ATTENTION_FILTER_LABEL, compareTableApplications, DEFAULT_APPLICATION_FILTERS,
  isFollowUpDue, matchesApplicationFilters, needsAttentionIds, STATUS_FILTER_LABELS,
  type AppliedRangePreset, type ApplicationFilters, type ArchiveScope, type StatusFilter, type TableSort, type TableSortKey,
} from "@/lib/application-list";
import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";
import { revealDelay, revealDelayMs } from "@/lib/motion-mode";
import { safeLink } from "@/lib/safe-link";
import { useOpeningReveal } from "@/hooks/use-opening-reveal";
import { useWeekStartDay } from "@/hooks/use-week-start-day";
import type { ApplicationRecord } from "@/types/application";

const controlFrameClass = "h-9 rounded-nook-sm border border-line bg-paper text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:opacity-60";
const controlClass = `${controlFrameClass} px-3`;
// Date fields use tighter padding so a custom range still fits on the filter row.
const dateControlClass = `${controlFrameClass} px-2.5`;
const APPLIED_RANGE_LABELS: Record<AppliedRangePreset, string> = { any: "Any time", week: "This week", month: "This month", "last-3-months": "Last 3 months", year: "This year", custom: "Custom range" };
const COLUMNS: Array<{ key: TableSortKey; label: string }> = [
  { key: "role", label: "Role" },
  { key: "company", label: "Company" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "appliedDate", label: "Applied" },
];

/** How many rows rise in when the page opens; about a screenful. */
const OPENING_ROW_LIMIT = 14;
const OPENING_ROW_TIMING = { base: 60, step: 35, limit: OPENING_ROW_LIMIT };

export function ApplicationsTable({ applications, boards, initialFilters, today, staleDays, movingIds, bulkBusy, searchInputRef, onOpen, onBulkStatus, onBulkArchive, onBulkDelete }: {
  applications: ApplicationRecord[];
  boards: BoardConfiguration[];
  initialFilters: ApplicationFilters;
  today: string;
  staleDays: ReadonlyMap<string, number>;
  movingIds: ReadonlySet<string>;
  bulkBusy: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpen: (application: ApplicationRecord) => void;
  onBulkStatus: (applications: ApplicationRecord[], status: Status) => Promise<void>;
  onBulkArchive: (applications: ApplicationRecord[], archived: boolean) => Promise<void>;
  /** Asks to confirm, then deletes; the trigger gets focus back if the delete is cancelled. */
  onBulkDelete: (applications: ApplicationRecord[], trigger: HTMLElement) => void;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState<TableSort>({ key: "appliedDate", direction: "desc" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // The preset last picked, so one of two presets covering the same days (This year and Last 3 months in March) stays shown.
  const [pickedPreset, setPickedPreset] = useState<AppliedRangePreset | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const firstDay = useWeekStartDay();

  // Keep the address in step with the filters so a reload or a shared link shows the same rows.
  useEffect(() => {
    const href = applicationTableHref(filters);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  }, [filters]);

  const attentionIds = needsAttentionIds(applications, staleDays.keys(), today);
  const rows = applications.filter((application) => matchesApplicationFilters(application, filters, attentionIds)).sort(compareTableApplications(sort));
  // Rows on screen when the page opens rise in one after another; rows shown later by filtering or sorting appear at once.
  const revealing = useOpeningReveal("table", revealDelayMs(OPENING_ROW_LIMIT, OPENING_ROW_TIMING));
  const selectedRows = rows.filter((application) => selected.has(application.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const archiveTarget = selectedRows.some((application) => !application.archived);
  const busy = bulkBusy || selectedRows.some((application) => movingIds.has(application.id));
  const pickedRange = pickedPreset && pickedPreset !== "custom" && today ? appliedRangeForPreset(pickedPreset, today, firstDay) : null;
  const pickedMatches = pickedRange !== null && pickedRange.appliedFrom === filters.appliedFrom && pickedRange.appliedTo === filters.appliedTo;
  const rangePreset = pickedPreset === "custom" ? "custom" : pickedMatches && pickedPreset ? pickedPreset : appliedRangePreset(filters, today, firstDay);
  const filtered = (Object.keys(DEFAULT_APPLICATION_FILTERS) as Array<keyof ApplicationFilters>).some((key) => filters[key] !== DEFAULT_APPLICATION_FILTERS[key]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedRows.length > 0 && !allSelected;
  });

  function update(patch: Partial<ApplicationFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function selectRangePreset(preset: AppliedRangePreset) {
    const localToday = today || currentLocalDate();
    setPickedPreset(preset);
    if (preset !== "custom") update(appliedRangeForPreset(preset, localToday, firstDay));
    else if (!filters.appliedFrom && !filters.appliedTo) update(appliedRangeForPreset("month", localToday));
  }

  // Either end may be left empty for an open range; a range can't end before it starts, so the other end follows.
  function updateRangeEdge(edge: "from" | "to", value: string) {
    setFilters((current) => {
      if (edge === "from") return { ...current, appliedFrom: value, appliedTo: value && current.appliedTo && current.appliedTo < value ? value : current.appliedTo };
      return { ...current, appliedTo: value, appliedFrom: value && current.appliedFrom && current.appliedFrom > value ? value : current.appliedFrom };
    });
  }

  function toggleSort(key: TableSortKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "appliedDate" ? "desc" : "asc" });
  }

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function runBulk(action: () => Promise<void>) {
    await action();
    setSelected(new Set());
  }

  return (
    <section aria-labelledby="table-heading" className="w-full min-w-0 pb-10">
      <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight" id="table-heading">Applications</h1>
      <p className="mt-1 text-sm text-ink-soft" role="status">Showing {rows.length} of {applications.length} applications</p>

      <div aria-label="Table filters" className="mt-6 flex flex-wrap items-end gap-2 border-b border-line pb-4" role="group">
        {/* The search box gives up width first so the filters stay on one line, but
            never below the width its placeholder needs. */}
        <label className="relative block min-w-54 max-w-60 flex-[1_1_13.5rem]">
          <span className="sr-only">Search company or role</span>
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input ref={searchInputRef} className="input h-9 pl-9 text-sm" maxLength={120} onChange={(event) => update({ search: event.target.value })} placeholder="Search company or role…" type="search" value={filters.search} />
        </label>
        <select aria-label="Filter by status" className={controlClass} onChange={(event) => update({ status: event.target.value as StatusFilter })} value={filters.status}>
          <option value="all">{STATUS_FILTER_LABELS.all}</option>
          <option value="active">{STATUS_FILTER_LABELS.active}</option>
          <option value="attention">{ATTENTION_FILTER_LABEL}</option>
          {boards.map((board) => <option key={board.status} value={board.status}>{board.label}</option>)}
        </select>
        <select aria-label="Archived applications" className={controlClass} onChange={(event) => update({ archived: event.target.value as ArchiveScope })} value={filters.archived}>
          <option value="active">Not archived</option>
          <option value="archived">Archived only</option>
          <option value="all">Include archived</option>
        </select>
        <select aria-label="Applied date range" className={controlClass} onChange={(event) => selectRangePreset(event.target.value as AppliedRangePreset)} value={rangePreset}>
          {(Object.keys(APPLIED_RANGE_LABELS) as AppliedRangePreset[]).map((preset) => <option key={preset} value={preset}>{APPLIED_RANGE_LABELS[preset]}</option>)}
        </select>
        {/* The date fields and Clear filters wrap as one group, so a narrow row
            breaks into a tidy second line instead of stranding the button. */}
        {(rangePreset === "custom" || filtered) && (
          <div className="flex items-center gap-2">
            {rangePreset === "custom" && (
              <div className="motion-small-reveal flex items-center gap-2 text-sm text-ink-soft">
                <input aria-label="Applied from" className={dateControlClass} onChange={(event) => updateRangeEdge("from", event.target.value)} type="date" value={filters.appliedFrom} />
                <span>to</span>
                <input aria-label="Applied to" className={dateControlClass} onChange={(event) => updateRangeEdge("to", event.target.value)} type="date" value={filters.appliedTo} />
              </div>
            )}
            {filtered && (
              <button className="btn-ghost h-9 px-3 py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => { setFilters(DEFAULT_APPLICATION_FILTERS); setPickedPreset(null); }} type="button">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {selectedRows.length > 0 && (
        <div aria-label="Bulk actions" className="motion-small-reveal mt-4 flex flex-wrap items-center gap-3 rounded-nook-sm border border-line bg-paper px-4 py-2.5" role="group">
          <span className="text-sm font-medium">{selectedRows.length} selected</span>
          <select
            aria-label="Change status of selected applications"
            className={controlClass}
            disabled={busy}
            onChange={(event) => {
              const status = event.target.value as Status;
              if (status) void runBulk(() => onBulkStatus(selectedRows, status));
            }}
            value=""
          >
            <option value="">Change status…</option>
            {boards.map((board) => <option key={board.status} value={board.status}>{board.label}</option>)}
          </select>
          <button className="btn-ghost h-9 px-3 py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" disabled={busy} onClick={() => void runBulk(() => onBulkArchive(selectedRows, archiveTarget))} type="button">
            {archiveTarget ? "Archive" : "Restore"}
          </button>
          <button className="btn-ghost h-9 px-3 py-0 text-rose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose" disabled={busy} onClick={(event) => onBulkDelete(selectedRows, event.currentTarget)} type="button">
            Delete
          </button>
          <button className="ml-auto rounded-nook-sm px-2 py-1 text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => setSelected(new Set())} type="button">
            Clear selection
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-10 text-sm text-ink-soft">{applications.length === 0 ? "No applications yet. Press N to add a job." : "No applications match these filters."}</p>
      ) : (
        <div className="scrollbar-styled scrollbar-x mt-4 overflow-x-auto rounded-nook border border-line bg-paper">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead className="border-b border-line bg-cream-2 text-xs font-semibold text-ink-soft">
              <tr>
                <th className="w-10 px-3 py-2.5" scope="col">
                  <input
                    ref={selectAllRef}
                    aria-label={allSelected ? "Deselect all shown applications" : "Select all shown applications"}
                    checked={allSelected}
                    className="h-4 w-4 accent-forest"
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((application) => application.id)))}
                    type="checkbox"
                  />
                </th>
                {COLUMNS.map((column) => (
                  <th aria-sort={sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : undefined} className="px-3 py-2.5" key={column.key} scope="col">
                    <button className="inline-flex items-center gap-1 rounded-nook-sm hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => toggleSort(column.key)} type="button">
                      {column.label}
                      <span aria-hidden="true" className={sort.key === column.key ? "text-ink" : "opacity-0"}>{sort.key === column.key && sort.direction === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((application, index) => {
                const stale = staleDays.get(application.id);
                const followUpDue = isFollowUpDue(application, today);
                const postingUrl = safeLink(application.jobUrl);
                const reveal = revealing && index < OPENING_ROW_LIMIT;
                return (
                  <tr
                    className={`motion-interactive hover:bg-cream-2 ${reveal ? "motion-reveal" : ""} ${selected.has(application.id) ? "bg-forest-tint/60" : ""}`}
                    data-application-id={application.id}
                    key={application.id}
                    style={reveal ? revealDelay(index, OPENING_ROW_TIMING) : undefined}
                  >
                    <td className="px-3 py-2.5">
                      <input aria-label={`Select ${application.role} at ${application.company}`} checked={selected.has(application.id)} className="h-4 w-4 accent-forest" onChange={() => toggleRow(application.id)} type="checkbox" />
                    </td>
                    <td className="max-w-64 px-3 py-2.5">
                      <button className="block max-w-full truncate rounded-nook-sm text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => onOpen(application)} type="button">
                        {application.role}
                      </button>
                    </td>
                    <td className="max-w-56 px-3 py-2.5 text-ink-soft">
                      <span className="flex items-center gap-1">
                        <span className="min-w-0 truncate">{application.company}</span>
                        {postingUrl && (
                          <a
                            aria-label={`Open the ${application.company} job posting in a new tab`}
                            className="inline-flex shrink-0 rounded-nook-sm text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
                            href={postingUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                            title="Open job posting"
                          >
                            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M7 17 17 7M8 7h9v9" />
                            </svg>
                          </a>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {/* Tags drop below the status only when the table is short on width. */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`status-dot ${boardDot(boards, application.status)}`} />{boardLabel(boards, application.status)}</span>
                        {application.archived && <span className="whitespace-nowrap text-xs text-ink-soft">Archived</span>}
                        {stale !== undefined && <span className="whitespace-nowrap rounded-full bg-clay-tint px-2 py-0.5 text-[11px] font-medium" title="No status update for a while">Stale · {stale}d</span>}
                        {followUpDue && application.followUpDate && (
                          <span className="whitespace-nowrap rounded-full bg-clay-tint px-2 py-0.5 text-[11px] font-medium" title={application.followUpNote ?? `Follow up on ${formatCalendarDate(application.followUpDate)}`}>
                            Follow up due · {formatCalendarDate(application.followUpDate)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-40 truncate px-3 py-2.5 text-ink-soft">{application.source?.trim() || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {formatCalendarDate(application.appliedDate)}
                      {today && <span className="ml-1.5 text-xs text-ink-soft">{formatDaysAgo(application.appliedDate, today)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

