import assert from "node:assert/strict";
import { test } from "node:test";
import { addCalendarDays, calendarDateInTimeZone, calendarDateKeySchema, parseCalendarDateKey, startOfCalendarWeek, timeZoneSchema } from "../src/lib/calendar-date.ts";

test("leap years and invalid calendar days", () => {
  assert.equal(parseCalendarDateKey("2028-02-29")?.toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(parseCalendarDateKey("2000-02-29")?.toISOString(), "2000-02-29T00:00:00.000Z");
  for (const value of ["1900-02-29", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "2026-01-01T00:00:00Z"]) {
    assert.equal(parseCalendarDateKey(value), null, value);
    assert.equal(calendarDateKeySchema.safeParse(value).success, false, value);
  }
});

test("day and week arithmetic cross month and year boundaries", () => {
  assert.equal(addCalendarDays("2028-02-28", 2), "2028-03-01");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2027-01-01", -1), "2026-12-31");
  assert.equal(startOfCalendarWeek("2027-01-03"), "2026-12-28");
  assert.throws(() => addCalendarDays("2026-02-30", 1), /Invalid calendar date/);
  assert.throws(() => startOfCalendarWeek("2026-02-30"), /Invalid calendar date/);
});

test("named time zones map instants across DST and date boundaries", () => {
  assert.equal(calendarDateInTimeZone(new Date("2026-03-08T04:30:00.000Z"), "America/New_York"), "2026-03-07");
  assert.equal(calendarDateInTimeZone(new Date("2026-03-08T07:30:00.000Z"), "America/New_York"), "2026-03-08");
  assert.equal(calendarDateInTimeZone(new Date("2026-11-01T05:30:00.000Z"), "America/New_York"), "2026-11-01");
  assert.equal(calendarDateInTimeZone(new Date("2026-12-31T20:00:00.000Z"), "Asia/Dhaka"), "2027-01-01");
  assert.equal(timeZoneSchema.safeParse("America/New_York").success, true);
  assert.equal(timeZoneSchema.safeParse("+06:00").success, false);
});
