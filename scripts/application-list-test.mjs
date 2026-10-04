import assert from "node:assert/strict";
import test from "node:test";
import { appliedRangeForPreset, appliedRangePreset, applicationSources, applicationTableHref, compareApplications, compareTableApplications, isFollowUpDue, matchesApplicationFilters, matchesApplicationSearch, needsAttentionIds, parseApplicationFilters } from "../src/lib/application-list.ts";
import { analyticsPeriodRange } from "../src/lib/analytics-period.ts";

test("search trims the query and matches across company and role", () => {
  const application = { company: "Acme Corp", role: "Engineer" };
  assert.equal(matchesApplicationSearch(application, " acme "), true);
  assert.equal(matchesApplicationSearch(application, "Corp Engineer"), true);
  assert.equal(matchesApplicationSearch(application, "engineer"), true);
  assert.equal(matchesApplicationSearch(application, "other"), false);
});

test("client order matches the API's appliedDate and createdAt descending order", () => {
  const rows = [
    { appliedDate: "2026-09-28T00:00:00.000Z", createdAt: "2026-09-28T10:00:00.000Z" },
    { appliedDate: "2026-09-29T00:00:00.000Z", createdAt: "2026-09-28T09:00:00.000Z" },
    { appliedDate: "2026-09-28T00:00:00.000Z", createdAt: "2026-09-28T12:00:00.000Z" },
  ];
  assert.deepEqual([...rows].sort(compareApplications), [rows[1], rows[2], rows[0]]);
});

const record = (overrides = {}) => ({
  id: "a1", company: "Acme", role: "Engineer", status: "APPLIED", source: "LinkedIn", archived: false,
  appliedDate: "2026-09-10T00:00:00.000Z", createdAt: "2026-09-10T08:00:00.000Z", ...overrides,
});

test("filters combine status, archive scope, applied range, and search", () => {
  assert.equal(matchesApplicationFilters(record(), {}), true);
  assert.equal(matchesApplicationFilters(record({ archived: true }), {}), false, "Archived applications are hidden by default");
  assert.equal(matchesApplicationFilters(record({ archived: true }), { archived: "archived" }), true);
  assert.equal(matchesApplicationFilters(record(), { archived: "archived" }), false);
  assert.equal(matchesApplicationFilters(record({ archived: true }), { archived: "all" }), true);
  assert.equal(matchesApplicationFilters(record({ status: "INTERVIEW" }), { status: "active" }), true);
  assert.equal(matchesApplicationFilters(record({ status: "OFFER" }), { status: "active" }), false);
  assert.equal(matchesApplicationFilters(record({ status: "OFFER" }), { status: "OFFER" }), true);
  assert.equal(matchesApplicationFilters(record(), { appliedFrom: "2026-09-10", appliedTo: "2026-09-10" }), true, "The applied range is inclusive");
  assert.equal(matchesApplicationFilters(record(), { appliedFrom: "2026-09-11" }), false);
  assert.equal(matchesApplicationFilters(record(), { appliedTo: "2026-09-09" }), false);
  assert.equal(matchesApplicationFilters(record(), { search: "acme eng" }), true);
  assert.equal(matchesApplicationFilters(record(), { search: "engineer acme" }), true, "Search words match in any order");
  assert.equal(matchesApplicationFilters(record(), { search: "  ENGINEER   acme " }), true, "Extra spaces and case are ignored");
  assert.equal(matchesApplicationFilters(record(), { search: "engineer other" }), false, "Every word must match");
  assert.equal(matchesApplicationFilters(record(), { search: "other" }), false);
});

test("sources are distinct, trimmed, and sorted", () => {
  assert.deepEqual(applicationSources([{ source: " LinkedIn" }, { source: "referral" }, { source: "linkedin" }, { source: null }, { source: "  " }, { source: "Company site" }]),
    ["Company site", "LinkedIn", "referral"]);
});

test("table sort orders one column and keeps empty values last in both directions", () => {
  const rows = [
    record({ role: "b", source: null }),
    record({ role: "a", source: "Referral", status: "OFFER", createdAt: "2026-09-10T09:00:00.000Z" }),
    record({ role: "c", source: "Board", status: "INTERVIEW" }),
  ];
  const roles = (key, direction) => [...rows].sort(compareTableApplications({ key, direction })).map(({ role }) => role);
  assert.deepEqual(roles("role", "asc"), ["a", "b", "c"]);
  assert.deepEqual(roles("role", "desc"), ["c", "b", "a"]);
  assert.deepEqual(roles("source", "asc"), ["c", "a", "b"]);
  assert.deepEqual(roles("source", "desc"), ["a", "c", "b"]);
  assert.deepEqual(roles("status", "asc"), ["b", "c", "a"], "Status follows the board order");
});

test("Needs attention keeps stale applications and due follow-ups", () => {
  const applications = [
    { id: "stale", followUpDate: null },
    { id: "due", followUpDate: "2026-09-29T00:00:00.000Z" },
    { id: "later", followUpDate: "2026-09-30T00:00:00.000Z" },
    { id: "quiet", followUpDate: null },
  ];
  const ids = needsAttentionIds(applications, ["stale"], "2026-09-29");
  assert.deepEqual([...ids].sort(), ["due", "stale"], "A follow-up due today counts; one due tomorrow does not");
  assert.equal(matchesApplicationFilters(record({ id: "stale" }), { status: "attention" }, ids), true);
  assert.equal(matchesApplicationFilters(record({ id: "quiet" }), { status: "attention" }, ids), false);
  assert.equal(matchesApplicationFilters(record({ id: "stale", archived: true }), { status: "attention" }, ids), false, "The archive scope still applies");
  assert.equal(matchesApplicationFilters(record({ id: "stale" }), { status: "attention" }), false, "Without attention ids nothing matches");
  assert.equal(parseApplicationFilters({ status: "attention" }).status, "attention");
  assert.equal(applicationTableHref({ status: "attention" }), "/table?status=attention");
});

test("a follow-up is due on or before today", () => {
  assert.equal(isFollowUpDue({ followUpDate: "2026-09-29T00:00:00.000Z" }, "2026-09-29"), true);
  assert.equal(isFollowUpDue({ followUpDate: "2026-09-30T00:00:00.000Z" }, "2026-09-29"), false);
  assert.equal(isFollowUpDue({ followUpDate: "2026-09-29T00:00:00.000Z" }, ""), false, "Nothing is due before today is known");
});

test("table filters round-trip through the address and ignore unknown values", () => {
  const filters = { search: "acme", status: "active", archived: "all", appliedFrom: "2026-09-01", appliedTo: "2026-09-30" };
  const href = applicationTableHref(filters);
  assert.equal(href, "/table?q=acme&status=active&archived=all&from=2026-09-01&to=2026-09-30");
  assert.deepEqual(parseApplicationFilters(Object.fromEntries(new URL(href, "http://nook.test").searchParams)), filters);
  assert.equal(applicationTableHref({}), "/table");
  assert.deepEqual(parseApplicationFilters({ status: "UNKNOWN", archived: "yes", from: "2026-9-1", to: ["2026-09-30", "2026-10-31"], source: "LinkedIn" }), {
    search: "", status: "all", archived: "active", appliedFrom: "", appliedTo: "2026-09-30",
  }, "Unknown values and the removed source filter are ignored");
});

test("applied range presets run from the start of the week, month, or year through today", () => {
  assert.deepEqual(appliedRangeForPreset("week", "2026-09-29"), { appliedFrom: "2026-09-28", appliedTo: "2026-09-29" }, "Weeks start on Monday by default");
  assert.deepEqual(appliedRangeForPreset("week", "2026-09-29", 0), { appliedFrom: "2026-09-27", appliedTo: "2026-09-29" }, "Sunday weeks start a day earlier");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-09-27", appliedTo: "2026-09-29" }, "2026-09-29", 0), "week");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-09-27", appliedTo: "2026-09-29" }, "2026-09-29"), "custom", "A Sunday week is custom when weeks start on Monday");
  assert.deepEqual(appliedRangeForPreset("month", "2026-09-29"), { appliedFrom: "2026-09-01", appliedTo: "2026-09-29" });
  assert.deepEqual(appliedRangeForPreset("year", "2026-09-29"), { appliedFrom: "2026-01-01", appliedTo: "2026-09-29" });
  assert.deepEqual(appliedRangeForPreset("last-3-months", "2026-09-29"), { appliedFrom: "2026-07-01", appliedTo: "2026-09-29" }, "This month and the two before it");
  assert.deepEqual(appliedRangeForPreset("last-3-months", "2026-02-10"), { appliedFrom: "2025-12-01", appliedTo: "2026-02-10" }, "Last 3 months crosses into the previous year");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-07-01", appliedTo: "2026-09-29" }, "2026-09-29"), "last-3-months");
  assert.deepEqual(appliedRangeForPreset("any", "2026-09-29"), { appliedFrom: "", appliedTo: "" });
  assert.equal(appliedRangePreset({ appliedFrom: "", appliedTo: "" }, "2026-09-29"), "any");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-09-28", appliedTo: "2026-09-29" }, "2026-09-29"), "week");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-09-01", appliedTo: "2026-09-29" }, "2026-09-29"), "month");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-01-01", appliedTo: "2026-09-29" }, "2026-09-29"), "year");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-09-01", appliedTo: "2026-09-30" }, "2026-09-29"), "custom", "A whole month is a custom range");
  assert.equal(appliedRangePreset({ appliedFrom: "2025-03-01", appliedTo: "2026-02-28" }, "2026-09-29"), "custom");
  assert.equal(appliedRangePreset({ appliedFrom: "2026-09-01", appliedTo: "2026-09-29" }, ""), "custom", "Presets need a known today");
});

test("Analytics current-period links open the table on the matching preset", () => {
  for (const [period, preset] of [["CURRENT_MONTH", "month"], ["CURRENT_YEAR", "year"]]) {
    const range = analyticsPeriodRange({ period }, "2026-09-29");
    const filters = parseApplicationFilters(Object.fromEntries(new URL(applicationTableHref({ appliedFrom: range.startDate, appliedTo: range.endDate }), "http://nook.test").searchParams));
    assert.equal(appliedRangePreset(filters, "2026-09-29"), preset, period);
  }
});
