import type { Status } from "@prisma/client";

import { featuredInterview } from "@/lib/interviews";
import { STATUS_VALUES } from "@/lib/status-values";

type SearchableApplication = { company: string; role: string };
type SortableApplication = { appliedDate: string; createdAt: string };
type FilterableApplication = SearchableApplication & { status: Status; source: string | null; archived: boolean; appliedDate: string };
type TableApplication = FilterableApplication & SortableApplication & { interviews: Array<{ id: string; date: string; time: string | null }> };

export const ACTIVE_PIPELINE_STATUSES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW"] as const satisfies readonly Status[];

export type StatusFilter = "all" | "active" | Status;
export const STATUS_FILTER_LABELS = { all: "All statuses", active: "Active pipeline" } as const;
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
