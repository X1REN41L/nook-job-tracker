import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsCohortLabel, analyticsPeriodRange, dateFromParts, monthEnd, shiftMonth } from "../src/lib/analytics-period.ts";

test("current periods use the supplied calendar day", () => {
  const today = "2026-01-15";
  assert.deepEqual(analyticsPeriodRange({ period: "CURRENT_MONTH" }, today), { startDate: "2026-01-01", endDate: today });
  assert.deepEqual(analyticsPeriodRange({ period: "LAST_3_MONTHS" }, today), { startDate: "2025-11-01", endDate: today });
  assert.deepEqual(analyticsPeriodRange({ period: "CURRENT_YEAR" }, today), { startDate: "2026-01-01", endDate: today });
  assert.throws(() => analyticsPeriodRange({ period: "CURRENT_YEAR" }), /calendar date/);
});

test("custom periods and labels handle leap and year boundaries", () => {
  assert.deepEqual(analyticsPeriodRange({ period: "CUSTOM_MONTH", month: "2028-02" }), { startDate: "2028-02-01", endDate: "2028-02-29" });
  assert.deepEqual(analyticsPeriodRange({ period: "CUSTOM_YEAR", year: 2026 }), { startDate: "2026-01-01", endDate: "2026-12-31" });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.equal(analyticsCohortLabel({ startDate: "2025-12-01", endDate: "2026-01-15" }, "LAST_3_MONTHS", "2026"), "December 2025 + January 1-15");
});

test("year 9999 ranges end on their final valid calendar day", () => {
  assert.deepEqual(analyticsPeriodRange({ period: "CUSTOM_YEAR", year: 9999 }), { startDate: "9999-01-01", endDate: "9999-12-31" });
  assert.deepEqual(analyticsPeriodRange({ period: "CUSTOM_MONTH", month: "9999-12" }), { startDate: "9999-12-01", endDate: "9999-12-31" });
  assert.equal(monthEnd(9999, 12), "9999-12-31");
  assert.equal(analyticsCohortLabel({ startDate: "9999-12-01", endDate: "9999-12-31" }, "CUSTOM_MONTH", "9999"), "December");
  assert.equal(dateFromParts(42, 0, 1).toISOString(), "0042-01-01T00:00:00.000Z");
});
