"use client";

import type { Status } from "@prisma/client";
import { useEffect, useRef, useState, type RefObject } from "react";

import { formatCalendarDate, formatDaysAgo } from "@/lib/application-date";
import {
  applicationTableHref, compareTableApplications, DEFAULT_APPLICATION_FILTERS, matchesApplicationFilters, STATUS_FILTER_LABELS,
  type ApplicationFilters, type ArchiveScope, type StatusFilter, type TableSort, type TableSortKey,
} from "@/lib/application-list";
import { boardDot, boardLabel, type BoardConfiguration } from "@/lib/board-preferences";
import { featuredInterview } from "@/lib/interviews";
import type { ApplicationRecord } from "@/types/application";

const controlClass = "h-9 rounded-nook-sm border border-line bg-paper px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest disabled:opacity-60";
const COLUMNS: Array<{ key: TableSortKey; label: string }> = [
  { key: "role", label: "Role" },
  { key: "company", label: "Company" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "appliedDate", label: "Applied" },
  { key: "interviewDate", label: "Interview" },
];

export function ApplicationsTable({ applications, boards, initialFilters, sources, today, staleDays, movingIds, bulkBusy, searchInputRef, onOpen, onBulkStatus, onBulkArchive }: {
  applications: ApplicationRecord[];
  boards: BoardConfiguration[];
  initialFilters: ApplicationFilters;
  sources: string[];
  today: string;
  staleDays: ReadonlyMap<string, number>;
  movingIds: ReadonlySet<string>;
  bulkBusy: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpen: (application: ApplicationRecord) => void;
  onBulkStatus: (applications: ApplicationRecord[], status: Status) => Promise<void>;
  onBulkArchive: (applications: ApplicationRecord[], archived: boolean) => Promise<void>;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState<TableSort>({ key: "appliedDate", direction: "desc" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Keep the address in step with the filters so a reload or a shared link shows the same rows.
  useEffect(() => {
    const href = applicationTableHref(filters);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  }, [filters]);

  const rows = applications.filter((application) => matchesApplicationFilters(application, filters)).sort(compareTableApplications(sort, today));
  const selectedRows = rows.filter((application) => selected.has(application.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const archiveTarget = selectedRows.some((application) => !application.archived);
  const busy = bulkBusy || selectedRows.some((application) => movingIds.has(application.id));
  const filtered = (Object.keys(DEFAULT_APPLICATION_FILTERS) as Array<keyof ApplicationFilters>).some((key) => filters[key] !== DEFAULT_APPLICATION_FILTERS[key]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedRows.length > 0 && !allSelected;
  });

  function update(patch: Partial<ApplicationFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function toggleSort(key: TableSortKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "appliedDate" || key === "interviewDate" ? "desc" : "asc" });
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
        <label className="relative block w-60">
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
          {boards.map((board) => <option key={board.status} value={board.status}>{board.label}</option>)}
        </select>
        <select aria-label="Filter by source" className={`${controlClass} max-w-48`} onChange={(event) => update({ source: event.target.value })} value={filters.source}>
          <option value="">All sources</option>
          {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          {filters.source && !sources.includes(filters.source) && <option value={filters.source}>{filters.source}</option>}
        </select>
        <select aria-label="Archived applications" className={controlClass} onChange={(event) => update({ archived: event.target.value as ArchiveScope })} value={filters.archived}>
          <option value="active">Not archived</option>
          <option value="archived">Archived only</option>
          <option value="all">Archived and not</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Applied from
          <input aria-label="Applied from" className={controlClass} max={filters.appliedTo || undefined} onChange={(event) => update({ appliedFrom: event.target.value })} type="date" value={filters.appliedFrom} />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          to
          <input aria-label="Applied to" className={controlClass} min={filters.appliedFrom || undefined} onChange={(event) => update({ appliedTo: event.target.value })} type="date" value={filters.appliedTo} />
        </label>
        {filtered && (
          <button className="btn-ghost h-9 px-3 py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => setFilters(DEFAULT_APPLICATION_FILTERS)} type="button">
            Clear filters
          </button>
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
          <button className="ml-auto rounded-nook-sm px-2 py-1 text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => setSelected(new Set())} type="button">
            Clear selection
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-10 text-sm text-ink-soft">{applications.length === 0 ? "No applications yet. Add a job from the Job Board to see it here." : "No applications match these filters."}</p>
      ) : (
        <div className="scrollbar-styled mt-4 overflow-x-auto rounded-nook border border-line bg-paper">
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
              {rows.map((application) => {
                const stale = staleDays.get(application.id);
                const interview = featuredInterview(application.interviews, today);
                return (
                  <tr className={`motion-interactive hover:bg-cream-2 ${selected.has(application.id) ? "bg-forest-tint/60" : ""}`} data-application-id={application.id} key={application.id}>
                    <td className="px-3 py-2.5">
                      <input aria-label={`Select ${application.role} at ${application.company}`} checked={selected.has(application.id)} className="h-4 w-4 accent-forest" onChange={() => toggleRow(application.id)} type="checkbox" />
                    </td>
                    <td className="max-w-64 px-3 py-2.5">
                      <button className="block max-w-full truncate rounded-nook-sm text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => onOpen(application)} type="button">
                        {application.role}
                      </button>
                    </td>
                    <td className="max-w-56 truncate px-3 py-2.5 text-ink-soft">{application.company}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5"><span className={`status-dot ${boardDot(boards, application.status)}`} />{boardLabel(boards, application.status)}</span>
                      {application.archived && <span className="ml-2 text-xs text-ink-soft">Archived</span>}
                      {stale !== undefined && !application.archived && <span className="ml-2 rounded-full bg-clay-tint px-2 py-0.5 text-[11px] font-medium" title="No status update for a while">Stale · {stale}d</span>}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2.5 text-ink-soft">{application.source?.trim() || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {formatCalendarDate(application.appliedDate)}
                      {today && <span className="ml-1.5 text-xs text-ink-soft">{formatDaysAgo(application.appliedDate, today)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{interview ? formatCalendarDate(interview.date) : "—"}</td>
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
