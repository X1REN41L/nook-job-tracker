"use client";

import { BOARD_STATUS_FILTER_LABELS, type BoardStatusFilter } from "@/lib/application-list";

export type BoardFilters = { status: BoardStatusFilter };
export const DEFAULT_BOARD_FILTERS: BoardFilters = { status: "all" };

const controlClass = "h-9 rounded-nook-sm border border-line bg-paper px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

export function BoardToolbar({ filters, shownCount, totalCount, onChange }: {
  filters: BoardFilters;
  shownCount: number;
  totalCount: number;
  onChange: (filters: BoardFilters) => void;
}) {
  const filtered = filters.status !== "all";

  return (
    <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight">Job Board</h1>
        <p className="mt-1 text-sm text-ink-soft" role="status">
          {filtered ? `Showing ${shownCount} of ${totalCount} active applications` : `${totalCount} active ${totalCount === 1 ? "application" : "applications"}`}
        </p>
      </div>
      <div aria-label="Board filters" className="flex flex-wrap items-center gap-2" role="group">
        <select aria-label="Filter by status" className={controlClass} onChange={(event) => onChange({ ...filters, status: event.target.value as BoardStatusFilter })} value={filters.status}>
          {(Object.keys(BOARD_STATUS_FILTER_LABELS) as BoardStatusFilter[]).map((filter) => <option key={filter} value={filter}>{BOARD_STATUS_FILTER_LABELS[filter]}</option>)}
        </select>
        {filtered && (
          <button className="btn-ghost h-9 px-3 py-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => onChange(DEFAULT_BOARD_FILTERS)} type="button">
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
