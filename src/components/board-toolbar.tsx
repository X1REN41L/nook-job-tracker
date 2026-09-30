"use client";

import type { RefObject } from "react";

import { BOARD_STATUS_FILTER_LABELS, type BoardStatusFilter } from "@/lib/application-list";

export type BoardFilters = { search: string; status: BoardStatusFilter };
export const DEFAULT_BOARD_FILTERS: BoardFilters = { search: "", status: "all" };

export function isBoardFiltered(filters: BoardFilters) {
  return filters.status !== "all" || filters.search.trim() !== "";
}

const controlClass = "h-9 rounded-nook-sm border border-line bg-paper px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

export function BoardToolbar({ filters, shownCount, totalCount, activeCount, headingRef, searchInputRef, onChange }: {
  filters: BoardFilters;
  shownCount: number;
  /** Every card on the board: all applications that aren't archived, Offer and Rejected included. */
  totalCount: number;
  /** Cards still in progress (Applied, Online assessment, Interview), as Overview's Active pipeline counts them. */
  activeCount: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onChange: (filters: BoardFilters) => void;
}) {
  const filtered = isBoardFiltered(filters);

  return (
    <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 ref={headingRef} className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight outline-none" tabIndex={-1}>Job Board</h1>
        <p className="mt-1 text-sm text-ink-soft" role="status">
          {filtered
            ? `Showing ${shownCount} of ${totalCount} ${totalCount === 1 ? "application" : "applications"}`
            : `${totalCount} ${totalCount === 1 ? "application" : "applications"} · ${activeCount} active`}
        </p>
      </div>
      <div aria-label="Board filters" className="flex flex-wrap items-center gap-2" role="group">
        <label className="relative block w-60">
          <span className="sr-only">Search company or role</span>
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input ref={searchInputRef} className="input h-9 pl-9 text-sm" maxLength={120} onChange={(event) => onChange({ ...filters, search: event.target.value })} placeholder="Search company or role…" type="search" value={filters.search} />
        </label>
        <select aria-label="Filter by status" className={controlClass} onChange={(event) => onChange({ ...filters, status: event.target.value as BoardStatusFilter })} value={filters.status}>
          {(Object.keys(BOARD_STATUS_FILTER_LABELS) as BoardStatusFilter[]).map((filter) => <option key={filter} value={filter}>{BOARD_STATUS_FILTER_LABELS[filter]}</option>)}
        </select>
      </div>
    </div>
  );
}
