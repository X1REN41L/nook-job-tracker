import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTypeScript(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  const load = (name) => dependencies[name] ?? require(name);
  new Function("require", "module", "exports", outputText)(load, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const calendar = loadTypeScript("../src/lib/calendar-date.ts");
const { groupUpcomingInterviews } = loadTypeScript("../src/lib/interviews.ts", {
  "@/lib/calendar-date": calendar,
});

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
    ["Later This Week", ["this-week-start", "this-week-end"]],
    ["Next Week", ["next-week-start", "next-week-end"]],
    ["Later", ["later"]],
  ]);
});

test("Saturday omits an empty Later This Week section", () => {
  assert.deepEqual(groupsFor("2026-10-03", [
    ["next", "2026-10-05"], ["tomorrow", "2026-10-04"], ["today", "2026-10-03"],
  ]), [
    ["Today", ["today"]], ["Tomorrow", ["tomorrow"]], ["Next Week", ["next"]],
  ]);
});

test("Sunday gives Tomorrow precedence over Next Week", () => {
  assert.deepEqual(groupsFor("2026-10-04", [
    ["next", "2026-10-06"], ["tomorrow", "2026-10-05"], ["today", "2026-10-04"],
  ]), [
    ["Today", ["today"]], ["Tomorrow", ["tomorrow"]], ["Next Week", ["next"]],
  ]);
});

test("Monday starts a new current week", () => {
  assert.deepEqual(groupsFor("2026-10-05", [
    ["this-week", "2026-10-07"], ["next-week", "2026-10-12"],
    ["tomorrow", "2026-10-06"], ["past", "2026-10-04"],
  ]), [
    ["Tomorrow", ["tomorrow"]],
    ["Later This Week", ["this-week"]],
    ["Next Week", ["next-week"]],
  ]);
});

test("calendar arithmetic crosses leap days without timezone shifts", () => {
  assert.equal(calendar.addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(calendar.addCalendarDays("2028-02-29", 1), "2028-03-01");
  assert.equal(calendar.startOfCalendarWeek("2028-03-05"), "2028-02-28");
  assert.deepEqual(groupsFor("2028-02-28", [
    ["tomorrow", "2028-02-29"], ["this-week", "2028-03-01"],
  ]), [["Tomorrow", ["tomorrow"]], ["Later This Week", ["this-week"]]]);
});
