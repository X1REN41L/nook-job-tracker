import assert from "node:assert/strict";
import { test } from "node:test";
import { backupSnapshotSchema, applicationRestoreSnapshotSchema, canonicalSnapshot } from "../src/lib/backup-snapshot.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";

const date = "2026-09-01T00:00:00.000Z";
const event = (id, fromStatus, toStatus, createdAt = date) => ({
  id, type: "STATUS_CHANGE", fromStatus, toStatus, detail: `${fromStatus ?? "null"} → ${toStatus}`,
  emailSnippet: null, createdAt,
});
const application = () => ({
  id: "app_1", company: "Acme", role: "Engineer", status: "INTERVIEW", archived: false,
  source: null, appliedDate: date, interviewDate: null, interviewDatePromptDismissed: false,
  notes: null, jobUrl: null, createdAt: date, lastUpdated: date,
  events: [event("first", null, "APPLIED"), event("second", "APPLIED", "INTERVIEW", "2026-09-02T00:00:00.000Z")],
});
const backup = (record = application()) => ({ version: 1, applications: [record], settings: defaultSettings });
const accepts = (record) => backupSnapshotSchema.safeParse(backup(record)).success;

test("complete typed history and settings validate without changing v1", () => {
  const result = backupSnapshotSchema.parse(backup());
  assert.equal(result.version, 1);
  assert.equal(result.applications[0].events[0].createdAt.toISOString(), date);
  assert.equal(accepts({ ...application(), status: "OFFER" }), false);
});

test("history rejects duplicate initial events, disconnected transitions and mismatched detail", () => {
  assert.equal(accepts({ ...application(), events: [...application().events, event("third", null, "OFFER", "2026-09-03T00:00:00.000Z")] }), false);
  assert.equal(accepts({ ...application(), events: [event("first", null, "APPLIED"), event("second", "OFFER", "INTERVIEW", "2026-09-02T00:00:00.000Z")] }), false);
  assert.equal(accepts({ ...application(), events: [{ ...application().events[0], detail: "wrong" }, application().events[1]] }), false);
  assert.equal(accepts({ ...application(), events: [event("first", null, "APPLIED", "2026-09-03T00:00:00.000Z"), event("second", "APPLIED", "INTERVIEW", date)] }), false);
});

test("legacy untyped history remains importable and equal-time transitions can be ordered", () => {
  const legacy = { ...application(), events: [{ ...application().events[0], fromStatus: null, toStatus: null, detail: "legacy" }] };
  assert.equal(accepts(legacy), true);
  assert.equal(accepts({ ...application(), events: [event("z", null, "APPLIED"), event("a", "APPLIED", "INTERVIEW")] }), true);
});

test("backup rejects future events, invalid stored fields and incomplete settings", () => {
  assert.equal(backupSnapshotSchema.safeParse(backup({ ...application(), events: [event("future", null, "INTERVIEW", "9999-01-01T00:00:00.000Z")] })).success, false);
  for (const change of [
    { appliedDate: "2026-09-01T06:00:00.000Z" }, { id: "export" }, { jobUrl: "javascript:alert(1)" },
    { source: " " }, { company: " Acme" },
  ]) assert.equal(accepts({ ...application(), ...change }), false, JSON.stringify(change));
  assert.equal(backupSnapshotSchema.safeParse({ ...backup(), settings: { ...defaultSettings, boards: [{}] } }).success, false);
});

test("restore accepts stored historical fields and canonical comparison ignores event order", () => {
  const stored = { ...application(), revision: 2, events: [...application().events].reverse() };
  assert.equal(applicationRestoreSnapshotSchema.safeParse(stored).success, true);
  assert.equal(canonicalSnapshot(stored), canonicalSnapshot({ ...stored, events: [...stored.events].reverse(), revision: 3 }));
});
