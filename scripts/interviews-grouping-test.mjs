import assert from "node:assert/strict";
import { test } from "node:test";
import * as calendar from "../src/lib/calendar-date.ts";
import { getInterviewListItems, getUpcomingInterviewCount, groupUpcomingInterviews } from "../src/lib/interviews.ts";

function item(id, date) {
  return { id, date: `${date}T00:00:00.000Z`, role: id, company: "Company", note: null };
}

function groupsFor(today, entries) {
  return groupUpcomingInterviews(entries.map(([id, date]) => item(id, date)), today)
    .map(({ label, interviews }) => [label, interviews.map(({ id }) => id)]);
}

test("Wednesday boundaries, chronological sections, and stable same-date order", () => {
  const entries = [
    ["next-week-end", "2026-10-11"], ["later", "2026-10-12"],
    ["b", "2026-09-30"], ["today", "2026-09-30"],
    ["this-week-end", "2026-10-04"], ["tomorrow", "2026-10-01"],
    ["next-week-start", "2026-10-05"], ["a", "2026-09-30"],
    ["this-week-start", "2026-10-02"], ["past", "2026-09-29"],
  ];
  assert.deepEqual(groupsFor("2026-09-30", entries), [
    ["Today", ["a", "b", "today"]],
    ["Tomorrow", ["tomorrow"]],
    ["Later this week", ["this-week-start", "this-week-end"]],
    ["Next week", ["next-week-start", "next-week-end"]],
    ["Later", ["later"]],
  ]);
});

test("Saturday omits an empty Later this week section", () => {
  assert.deepEqual(groupsFor("2026-10-03", [
    ["next", "2026-10-05"], ["tomorrow", "2026-10-04"], ["today", "2026-10-03"],
  ]), [
    ["Today", ["today"]], ["Tomorrow", ["tomorrow"]], ["Next week", ["next"]],
  ]);
});

test("Sunday gives Tomorrow precedence over Next week", () => {
  assert.deepEqual(groupsFor("2026-10-04", [
    ["next", "2026-10-06"], ["tomorrow", "2026-10-05"], ["today", "2026-10-04"],
  ]), [
    ["Today", ["today"]], ["Tomorrow", ["tomorrow"]], ["Next week", ["next"]],
  ]);
});

test("Monday starts a new current week", () => {
  assert.deepEqual(groupsFor("2026-10-05", [
    ["this-week", "2026-10-07"], ["next-week", "2026-10-12"],
    ["tomorrow", "2026-10-06"], ["past", "2026-10-04"],
  ]), [
    ["Tomorrow", ["tomorrow"]],
    ["Later this week", ["this-week"]],
    ["Next week", ["next-week"]],
  ]);
});

test("calendar arithmetic crosses leap days without timezone shifts", () => {
  assert.equal(calendar.addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(calendar.addCalendarDays("2028-02-29", 1), "2028-03-01");
  assert.equal(calendar.startOfCalendarWeek("2028-03-05"), "2028-02-28");
  assert.deepEqual(groupsFor("2028-02-28", [
    ["tomorrow", "2028-02-29"], ["this-week", "2028-03-01"],
  ]), [["Tomorrow", ["tomorrow"]], ["Later this week", ["this-week"]]]);
});

test("the featured round is the next one on or after today, else the latest", async () => {
  const { featuredInterview, compareInterviews, formatInterviewTime } = await import("../src/lib/interviews.ts");
  const round = (id, date, time = null) => ({ id, date: `${date}T00:00:00.000Z`, time });
  const rounds = [round("late", "2026-10-09"), round("next-timed", "2026-10-01", "09:30"), round("next-all-day", "2026-10-01"), round("past", "2026-09-20")];
  assert.equal(featuredInterview(rounds, "2026-10-01").id, "next-all-day", "All-day rounds sort before timed rounds on the same date");
  assert.equal(featuredInterview(rounds, "2026-10-02").id, "late");
  assert.equal(featuredInterview(rounds, "2026-10-10").id, "late", "With nothing upcoming, the latest round is shown");
  assert.equal(featuredInterview([], "2026-10-10"), undefined);
  assert.deepEqual([...rounds].sort(compareInterviews).map(({ id }) => id), ["past", "next-all-day", "next-timed", "late"]);
  assert.match(formatInterviewTime("09:30"), /9:30/);
});

test("upcoming interviews count only applications still in progress", () => {
  const today = "2026-09-30";
  const application = (id, status, archived, dates) => ({
    id, status, archived, role: id, company: "Company",
    interviews: dates.map((date, index) => ({ id: `${id}-${index}`, date: `${date}T00:00:00.000Z`, time: null, type: "OTHER", interviewers: null, notes: null })),
  });
  const applications = [
    application("two-rounds", "INTERVIEW", false, ["2026-09-30", "2026-10-07"]),
    application("applied", "APPLIED", false, ["2026-10-02"]),
    application("archived", "INTERVIEW", true, ["2026-10-05"]),
    application("offer", "OFFER", false, ["2026-10-01"]),
    application("rejected", "REJECTED", false, ["2026-10-03"]),
    application("past-only", "INTERVIEW", false, ["2026-09-29"]),
  ];
  assert.equal(getUpcomingInterviewCount(applications, today), 3);
  const items = getInterviewListItems(applications);
  assert.deepEqual(items.filter(({ inProgress }) => inProgress).map(({ applicationId }) => applicationId),
    ["two-rounds", "two-rounds", "applied", "past-only"]);
  assert.equal(items.length, 7, "Closed and archived rounds stay in the list for the Past tab");
});
