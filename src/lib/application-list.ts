import type { Status } from "@prisma/client";

import { startOfCalendarWeek } from "@/lib/calendar-date";
import { featuredInterview } from "@/lib/interviews";
import { STATUS_VALUES } from "@/lib/status-values";

type SearchableApplication = { company: string; role: string };
type SortableApplication = { appliedDate: string; createdAt: string };
type FilterableApplication = SearchableApplication & { status: Status; source: string | null; archived: boolean; appliedDate: string };
type TableApplication = FilterableApplication & SortableApplication & { interviews: Array<{ id: string; date: string; time: string | null }> };

export const ACTIVE_PIPELINE_STATUSES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW"] as const satisfies readonly Status[];

export type StatusFilter = "all" | "active" | Status;
export const STATUS_FILTER_LABELS = { all: "All statuses", active: "Active pipeline" } as const;
export const OUTCOME_STATUSES = ["OFFER", "REJECTED"] as const satisfies readonly Status[];
export type BoardStatusFilter = "all" | "active" | "outcomes";
export const BOARD_STATUS_FILTER_LABELS = { ...STATUS_FILTER_LABELS, outcomes: "Outcomes" } as const;
export type ArchiveScope = "active" | "archived" | "all";
export type ApplicationFilters = {
  search: string;
  status: StatusFilter;
  source: string;
  archived: ArchiveScope;
  appliedFrom: string;
  appliedTo: string;
};

export const DEFAULT_APPLICATION_FILTERS: ApplicationFilters = { search: "", status: "all", source: "", archived: "active", appliedFrom: "", appliedTo: "" };

export function matchesApplicationSearch(application: SearchableApplication, search: string) {
  const query = search.trim().toLowerCase();
  return `${application.company} ${application.role}`.toLowerCase().includes(query);
}

function sourceKey(source: string | null) {
  return source?.trim().toLowerCase() ?? "";
}

export function matchesApplicationFilters(application: FilterableApplication, filters: Partial<ApplicationFilters>) {
  const { search = "", status = "all", source = "", archived = "active", appliedFrom = "", appliedTo = "" } = filters;
  if (archived !== "all" && application.archived !== (archived === "archived")) return false;
  if (status === "active" ? !(ACTIVE_PIPELINE_STATUSES as readonly Status[]).includes(application.status) : status !== "all" && application.status !== status) return false;
  if (source && sourceKey(application.source) !== sourceKey(source)) return false;
  const applied = application.appliedDate.slice(0, 10);
  if ((appliedFrom && applied < appliedFrom) || (appliedTo && applied > appliedTo)) return false;
  return matchesApplicationSearch(application, search);
}

export function matchesBoardStatusFilter(status: Status, filter: BoardStatusFilter) {
  if (filter === "active") return (ACTIVE_PIPELINE_STATUSES as readonly Status[]).includes(status);
  if (filter === "outcomes") return (OUTCOME_STATUSES as readonly Status[]).includes(status);
  return true;
}

/** Distinct sources in first-used spelling, ignoring case and surrounding spaces. */
export function applicationSources(applications: Array<{ source: string | null }>) {
  const sources = new Map<string, string>();
  for (const { source } of applications) {
    const key = sourceKey(source);
    if (key && !sources.has(key)) sources.set(key, source!.trim());
  }
  return [...sources.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function compareApplications(left: SortableApplication, right: SortableApplication) {
  return right.appliedDate.localeCompare(left.appliedDate) || right.createdAt.localeCompare(left.createdAt);
}

export const TABLE_SORT_KEYS = ["role", "company", "status", "source", "appliedDate", "interviewDate"] as const;
export type TableSortKey = (typeof TABLE_SORT_KEYS)[number];
export type TableSort = { key: TableSortKey; direction: "asc" | "desc" };

/**
 * Sorts by one column; empty values always go last, and ties keep the default application order.
 * The Interview column shows (and sorts by) the next round on or after `today`, or else the latest one.
 */
export function compareTableApplications(sort: TableSort, today: string) {
  const sign = sort.direction === "asc" ? 1 : -1;
  return (left: TableApplication, right: TableApplication) => {
    const value = (application: TableApplication) => {
      if (sort.key === "status") return String(STATUS_VALUES.indexOf(application.status)).padStart(2, "0");
      if (sort.key === "source") return application.source?.trim() ?? "";
      if (sort.key === "interviewDate") return featuredInterview(application.interviews, today)?.date.slice(0, 10) ?? "";
      if (sort.key === "appliedDate") return application.appliedDate.slice(0, 10);
      return application[sort.key];
    };
    const leftValue = value(left);
    const rightValue = value(right);
    if (!leftValue || !rightValue) return (leftValue ? -1 : 0) + (rightValue ? 1 : 0) || compareApplications(left, right);
    return sign * leftValue.localeCompare(rightValue, undefined, { sensitivity: "base", numeric: true }) || compareApplications(left, right);
  };
}

export type AppliedRangePreset = "any" | "week" | "month" | "year" | "custom";
type AppliedRange = Pick<ApplicationFilters, "appliedFrom" | "appliedTo">;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** First calendar date of a month (1–12). */
export function monthStartKey(year: number, month: number) {
  return `${year}-${pad(month)}-01`;
}

/** Last calendar date of a month (1–12). */
export function monthEndKey(year: number, month: number) {
  return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/**
 * The applied range a preset covers: from the start of the week, month, or year through `today`, the same
 * to-date ranges Analytics uses for its current periods, so its links open on the matching preset.
 * "any" clears the range.
 */
export function appliedRangeForPreset(preset: Exclude<AppliedRangePreset, "custom">, today: string): AppliedRange {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (preset === "week") return { appliedFrom: startOfCalendarWeek(today), appliedTo: today };
  if (preset === "month") return { appliedFrom: monthStartKey(year, month), appliedTo: today };
  if (preset === "year") return { appliedFrom: monthStartKey(year, 1), appliedTo: today };
  return { appliedFrom: "", appliedTo: "" };
}

/** Names the preset a range matches, or "custom" when it matches none (or `today` is not known yet). */
export function appliedRangePreset(range: AppliedRange, today: string): AppliedRangePreset {
  if (!range.appliedFrom && !range.appliedTo) return "any";
  if (!today) return "custom";
  for (const preset of ["week", "month", "year"] as const) {
    const candidate = appliedRangeForPreset(preset, today);
    if (candidate.appliedFrom === range.appliedFrom && candidate.appliedTo === range.appliedTo) return preset;
  }
  return "custom";
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
type SearchParams = Record<string, string | string[] | undefined>;

/** Reads table filters from URL search parameters, ignoring values it does not recognize. */
export function parseApplicationFilters(params: SearchParams): ApplicationFilters {
  const read = (name: string) => {
    const value = params[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const status = read("status");
  const archived = read("archived");
  const appliedFrom = read("from");
  const appliedTo = read("to");
  return {
    search: read("q").slice(0, 120),
    status: status === "active" || (STATUS_VALUES as readonly string[]).includes(status) ? status as StatusFilter : "all",
    source: read("source").slice(0, 120),
    archived: archived === "archived" || archived === "all" ? archived : "active",
    appliedFrom: DATE_KEY.test(appliedFrom) ? appliedFrom : "",
    appliedTo: DATE_KEY.test(appliedTo) ? appliedTo : "",
  };
}

/** Builds a table address for the given filters; defaults are left out. */
export function applicationTableHref(filters: Partial<ApplicationFilters>) {
  const query = new URLSearchParams();
  if (filters.search) query.set("q", filters.search);
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.source) query.set("source", filters.source);
  if (filters.archived && filters.archived !== "active") query.set("archived", filters.archived);
  if (filters.appliedFrom) query.set("from", filters.appliedFrom);
  if (filters.appliedTo) query.set("to", filters.appliedTo);
  const search = query.toString();
  return search ? `/table?${search}` : "/table";
}
