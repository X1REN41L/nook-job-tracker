"use client";

import type { RefObject } from "react";

import { STATUS_FILTER_LABELS, type ApplicationFilters, type StatusFilter } from "@/lib/application-list";
import type { BoardConfiguration } from "@/lib/board-preferences";

export type BoardFilters = Pick<ApplicationFilters, "search" | "status" | "source">;
export const DEFAULT_BOARD_FILTERS: BoardFilters = { search: "", status: "all", source: "" };

const controlClass = "h-9 rounded-nook-sm border border-line bg-paper px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

export function BoardToolbar({ boards, filters, sources, shownCount, totalCount, searchInputRef, onChange }: {
  boards: BoardConfiguration[];
  filters: BoardFilters;
  sources: string[];
  shownCount: number;
  totalCount: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onChange: (filters: BoardFilters) => void;
}) {
  const filtered = filters.search.trim() !== "" || filters.status !== "all" || filters.source !== "";

  return (
    <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight">Job Board</h1>
        <p className="mt-1 text-sm text-ink-soft" role="status">
          {filtered ? `Showing ${shownCount} of ${totalCount} active applications` : `${totalCount} active ${totalCount === 1 ? "application" : "applications"}`}
        </p>
      </div>
      <div aria-label="Board filters" className="flex flex-wrap items-center gap-2" role="group">
        <label className="relative block w-60">
          <span className="sr-only">Search the board</span>
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            className="input h-9 pl-9 text-sm"
            maxLength={120}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Search company or role…"
            type="search"
            value={filters.search}
          />
        </label>
        <select aria-label="Filter by status" className={controlClass} onChange={(event) => onChange({ ...filters, status: event.target.value as StatusFilter })} value={filters.status}>
          <option value="all">{STATUS_FILTER_LABELS.all}</option>
          <option value="active">{STATUS_FILTER_LABELS.active}</option>
          {boards.map((board) => <option key={board.status} value={board.status}>{board.label}</option>)}
        </select>
        <select aria-label="Filter by source" className={`${controlClass} max-w-48`} onChange={(event) => onChange({ ...filters, source: event.target.value })} value={filters.source}>
          <option value="">All sources</option>
          {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          {filters.source && !sources.includes(filters.source) && <option value={filters.source}>{filters.source}</option>}
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
