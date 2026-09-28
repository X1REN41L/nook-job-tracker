import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStatusHistory, nextStatusEventTime, parseStatusTransitionDetail, statusTransitionDetail } from "../src/lib/status-history.ts";

const at = (value) => new Date(value);
const event = (id, fromStatus, toStatus, createdAt) => ({ id, type: "STATUS_CHANGE", fromStatus, toStatus, detail: statusTransitionDetail(fromStatus, toStatus), createdAt });

test("new status timestamps advance past future and equal latest events", () => {
  const now = at("2026-09-01T00:00:00.000Z");
  assert.equal(nextStatusEventTime(null, now).getTime(), now.getTime());
  assert.equal(nextStatusEventTime(at("2026-08-31T00:00:00.000Z"), now).getTime(), now.getTime());
  assert.equal(nextStatusEventTime(now, now).getTime(), now.getTime() + 1);
  assert.equal(nextStatusEventTime(at("2099-01-01T00:00:00.000Z"), now).toISOString(), "2099-01-01T00:00:00.001Z");
});

test("analysis sorts status events and identifies the latest event", () => {
  const first = event("a", null, "APPLIED", "2026-09-01T00:00:00.000Z");
  const second = event("b", "APPLIED", "INTERVIEW", "2026-09-01T00:00:00.001Z");
  const result = analyzeStatusHistory("INTERVIEW", [second, { id: "note", type: "NOTE", createdAt: first.createdAt }, first]);
  assert.equal(result.complete, true);
  assert.equal(result.latestStatusEvent.id, "b");
  assert.deepEqual([...result.knownStatuses].sort(), ["APPLIED", "INTERVIEW"]);
  assert.equal(analyzeStatusHistory("APPLIED", [first]).latestStatusEvent.id, "a");
});

test("equal-time and incomplete histories do not claim a complete ordered trail", () => {
  const time = "2026-09-01T00:00:00.000Z";
  const first = event("a", null, "APPLIED", time);
  const second = event("b", "APPLIED", "INTERVIEW", time);
  assert.equal(analyzeStatusHistory("INTERVIEW", [first, second]).complete, false);
  assert.equal(analyzeStatusHistory("APPLIED", [first, second]).complete, false);
  assert.equal(analyzeStatusHistory("INTERVIEW", [{ ...first, toStatus: null }]).complete, false);
});

test("removed undo move restores the prior milestone trail", () => {
  const first = event("a", null, "APPLIED", "2026-01-01T00:00:00.000Z");
  const moved = event("b", "APPLIED", "OFFER", "2026-09-01T00:00:00.000Z");
  assert.equal(analyzeStatusHistory("OFFER", [first, moved]).knownStatuses.has("OFFER"), true);
  const undone = analyzeStatusHistory("APPLIED", [first]);
  assert.equal(undone.complete, true);
  assert.equal(undone.knownStatuses.has("OFFER"), false);
  assert.equal(undone.latestStatusEvent.id, "a");
  assert.deepEqual(parseStatusTransitionDetail("APPLIED → OFFER"), { fromStatus: "APPLIED", toStatus: "OFFER" });
  assert.equal(parseStatusTransitionDetail("APPLIED → APPLIED"), null);
});
