import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const origin = new URL(base).origin;
const mutationHeaders = { Origin: origin, "Content-Type": "application/json" };
const prisma = new PrismaClient();
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(body) });
const input = (role) => ({ company: "Backup API test", role, status: "APPLIED", appliedDate: "2026-09-24" });
const settings = { theme: "system", defaultBoard: "APPLIED", startupPage: "dashboard", staleApplicationThreshold: 15, motion: "system", timeFormat: "system", sidebarCollapsed: false, archivedExpanded: false, allApplicationsExpanded: true };
const backup = (applications) => ({ version: 1, applications, settings });
const record = (role) => ({ id: randomUUID(), company: "Backup API test", role, status: "APPLIED", source: null,
  appliedDate: "2026-09-24T00:00:00.000Z", followUpDate: null, followUpNote: null, interviewDatePromptDismissed: true, interviews: [], contacts: [],
  notes: "Preserved note", jobUrl: null, createdAt: "2026-09-24T01:00:00.000Z", lastUpdated: "2026-09-24T02:00:00.000Z",
  events: [{ id: randomUUID(), type: "STATUS_CHANGE", detail: "ONLINE_ASSESSMENT → APPLIED", fromStatus: "ONLINE_ASSESSMENT", toStatus: "APPLIED", createdAt: "2026-09-24T01:30:00.000Z" }] });
async function assertValidationIssues(response, expectedPaths) {
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.ok(Array.isArray(body.issues));
  for (const issue of body.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["message", "path"]);
    assert.equal(typeof issue.path, "string");
    assert.equal(typeof issue.message, "string");
  }
  const paths = body.issues.map((issue) => issue.path);
  for (const path of expectedPaths) assert.ok(paths.includes(path), `Expected validation path ${path}; received ${paths.join(", ")}`);
  assert.doesNotMatch(JSON.stringify(body), /stack|Prisma|database query/i);
}

try {
  const baselineCount = await prisma.application.count();
  const oversized = await fetch(`${base}/api/applications/import`, {
    method: "POST", headers: mutationHeaders, body: " ".repeat(10 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /10 MB/);
  assert.equal(await prisma.application.count(), baselineCount, "Oversized request must not create records");
  const oversizedChunkedStatus = await new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base);
    const outgoing = http.request({ hostname, port, path: "/api/applications/import", method: "POST", headers: mutationHeaders }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    outgoing.on("error", reject);
    const chunk = " ".repeat(1024 * 1024);
    for (let index = 0; index < 11; index += 1) outgoing.write(chunk);
    outgoing.end();
  });
  assert.equal(oversizedChunkedStatus, 413, "Chunked bodies over 10 MB must reach the route's own size limit");
  assert.equal(await prisma.application.count(), baselineCount, "Oversized chunked request must not create records");

  const tooManyApplications = await post("/api/applications/import", backup(Array(5_001).fill(null)));
  assert.equal(tooManyApplications.status, 413);
  assert.match((await tooManyApplications.json()).error, /5,000 applications/);
  assert.equal(await prisma.application.count(), baselineCount, "Over-limit application count must not create records");

  const malformedJson = await fetch(`${base}/api/applications/import`, {
    method: "POST", headers: mutationHeaders, body: "{not json",
  });
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json()).error, "Request body must be valid JSON");
  assert.equal(await prisma.application.count(), baselineCount, "Malformed backup must not create records");

  await assertValidationIssues(await post("/api/applications", { ...input("invalid create"), company: "" }), ["company"]);
  const created = await post("/api/applications", input("seed"));
  assert.equal(created.status, 201);
  let application = (await created.json()).application;
  assert.equal(application.revision, 0);
  await assertValidationIssues(await fetch(`${base}/api/applications/${application.id}`, {
    method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: application.revision, status: "INVALID" }),
  }), ["status"]);
  await assertValidationIssues(await fetch(`${base}/api/applications/${application.id}`, {
    method: "PUT", headers: mutationHeaders, body: JSON.stringify({ company: "Backup API test", role: "", appliedDate: "2026-09-24", revision: application.revision }),
  }), ["role"]);
  const forged = await fetch(`${base}/api/applications`, { headers: { "x-forwarded-for": "203.0.113.19" } });
  assert.equal(forged.status, 200);
  const exported = await (await fetch(`${base}/api/applications/export`)).json();
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.settings, settings);
  assert.equal(exported.applications.length, 1);
  assert.equal("revision" in exported.applications[0], false, "Backup exports must not include application revisions");
  const seedId = exported.applications[0].id;
  const moved = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: application.revision, status: "INTERVIEW" }) });
  assert.equal(moved.status, 200);
  application = (await moved.json()).application;
  assert.equal(application.revision, 1);
  const archived = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: application.revision, archived: true }) });
  assert.equal(archived.status, 200);
  application = (await archived.json()).application;
  assert.equal(application.status, "INTERVIEW");
  assert.equal(application.revision, 2);
  const withEvents = await (await fetch(`${base}/api/applications/export`)).json();
  assert.equal(withEvents.applications[0].events.length, 2, "A created application keeps its initial status event");
  assert.ok(withEvents.applications[0].events.some(({ fromStatus, toStatus }) => fromStatus === null && toStatus === "APPLIED"));
  assert.ok(withEvents.applications[0].events.some(({ fromStatus, toStatus }) => fromStatus === "APPLIED" && toStatus === "INTERVIEW"));
  assert.equal(withEvents.applications[0].archived, true);
  const undoBeforePlainDelete = await prisma.undoSnapshot.count();
  assert.equal((await fetch(`${base}/api/applications/${seedId}`, { method: "DELETE", headers: mutationHeaders })).status, 204);
  assert.equal(await prisma.undoSnapshot.count(), undoBeforePlainDelete, "Plain DELETE is permanent and does not create an undo snapshot");
  const restored = await post("/api/applications/import", withEvents);
  assert.equal(restored.status, 201, await restored.clone().text());
  const importResult = await restored.json();
  assert.deepEqual(importResult.createdIds, [seedId]);
  assert.equal(importResult.applications[0].revision, 0, "Backup import should start at the database default revision");
  const roundTrip = await (await fetch(`${base}/api/applications/export`)).json();
  assert.deepEqual(roundTrip.applications, withEvents.applications);
  const identical = await post("/api/applications/import", backup(withEvents.applications));
  assert.equal(identical.status, 201);
  assert.deepEqual((await identical.json()).skippedIds, [seedId]);
  const conflictCount = await prisma.application.count();
  const conflictSettings = await prisma.settings.findUnique({ where: { id: 1 } });
  const conflictingImport = await post("/api/applications/import", backup([{ ...withEvents.applications[0], role: "conflict" }]));
  assert.equal(conflictingImport.status, 409);
  const conflictBody = await conflictingImport.json();
  assert.deepEqual(conflictBody.conflicts, [seedId]);
  assert.match(conflictBody.error, /Backup API test — seed/);
  assert.match(conflictBody.error, /No applications or settings were imported/);
  assert.equal(await prisma.application.count(), conflictCount);
  assert.deepEqual(await prisma.settings.findUnique({ where: { id: 1 } }), conflictSettings);
  await assertValidationIssues(await post("/api/applications/import", backup([
    { ...record("invalid status"), status: "INVALID" },
    { ...record("invalid fields"), company: "", appliedDate: "invalid" },
  ])), ["applications[0].status", "applications[1].company", "applications[1].appliedDate"]);
  await assertValidationIssues(await post("/api/applications/import", backup([
    { ...record("invalid event"), events: [{ ...record("event").events[0], fromStatus: "INTERVIEW", toStatus: "OFFER" }] },
  ])), ["applications[0].events[0]"]);
  assert.equal(await prisma.application.count(), 1);
  const changedForUndo = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: 0, archived: false }) });
  assert.equal(changedForUndo.status, 200);
  assert.equal((await changedForUndo.json()).application.revision, 1);
  await assertValidationIssues(await post("/api/applications/import", { ...backup([]), version: 2 }), ["version"]);
  await assertValidationIssues(await post("/api/applications/import", { ...backup([]), settings: { ...settings, startupPage: undefined } }), ["settings.startupPage"]);
  await assertValidationIssues(await post("/api/applications/import", { ...backup([]), settings: { ...settings, allApplicationsExpanded: undefined } }), ["settings.allApplicationsExpanded"]);
  await assertValidationIssues(await post("/api/applications/import", { ...backup([]), settings: { ...settings, motion: "reduced" } }), ["settings.motion"]);
  await assertValidationIssues(await post("/api/applications/import", { ...backup([]), settings: { ...settings, timeFormat: undefined } }), ["settings.timeFormat"]);
  await assertValidationIssues(await post("/api/applications/import", { ...backup([]), settings: { ...settings, timeFormat: "36h" } }), ["settings.timeFormat"]);
  const boardColorsResponse = await post("/api/applications/import", { ...backup([]), settings: { ...settings, boards: [] } });
  assert.equal(boardColorsResponse.status, 400, "Board colors are no longer part of the backup settings");
  const initial = { id: randomUUID(), type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: "2026-09-24T01:00:00.000Z" };
  const complete = { ...record("complete history"), archived: false, events: [initial] };
  await assertValidationIssues(await post("/api/applications/import", backup([{ ...complete, status: "OFFER" }])), ["applications[0].status"]);
  await assertValidationIssues(await post("/api/applications/import", backup([{ ...record("missing archived"), archived: undefined }])), ["applications[0].archived"]);
  await assertValidationIssues(await post("/api/applications/import", backup([{ ...record("missing transition"), events: [{ ...record("event").events[0], fromStatus: undefined }] }])), ["applications[0].events[0].fromStatus"]);
  assert.equal(await prisma.application.count(), 1, "Outdated backups must not create records");
  assert.equal((await post("/api/applications/import", { version: 1, applications: [], settings: { ...settings, startupPage: "interviews", staleApplicationThreshold: 30 } })).status, 201);
  assert.equal((await post("/api/applications/import", { ...backup([]), settings: { ...settings, motion: "on" } })).status, 201);
  assert.equal((await post("/api/applications/import", { ...backup([]), settings: { ...settings, motion: "off" } })).status, 201);
  assert.equal((await post("/api/applications/import", { version: 1, applications: [], settings: { ...settings, staleApplicationThreshold: 14 } })).status, 400);
  assert.equal((await post("/api/applications/import", { version: 1, applications: [], settings: { ...settings, staleApplicationThreshold: 21 } })).status, 400);
  assert.equal((await post("/api/applications/import", [])).status, 400);
  assert.equal((await post("/api/applications/import", backup([]))).status, 201);
  assert.equal((await post("/api/applications/import", backup([{ ...complete, id: randomUUID(), events: [{ ...initial, id: randomUUID(), toStatus: null, detail: null }] }]))).status, 201, "Incomplete legacy history remains importable");
  // A save from before board colors were removed and before the time format setting existed.
  const { timeFormat: _timeFormat, ...olderSettings } = settings;
  await prisma.settings.update({ where: { id: 1 }, data: { value: JSON.stringify({ ...olderSettings, theme: "dark", boards: [{ status: "APPLIED", color: "rose" }] }) } });
  const legacySettings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(legacySettings.settings.theme, "dark", "Saved settings keep their values when they still carry board colors");
  assert.equal("boards" in legacySettings.settings, false);
  assert.equal(legacySettings.settings.timeFormat, "system", "Saves from before the time format setting follow the browser's clock");
  const beforeSettings = await (await fetch(`${base}/api/settings`)).json();
  const changedSettingsResponse = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: beforeSettings.revision, changes: { theme: "dark", staleApplicationThreshold: 30 } }) });
  assert.equal(changedSettingsResponse.status, 200);
  const changedSettings = await changedSettingsResponse.json();
  assert.equal(changedSettings.settings.staleApplicationThreshold, 30);
  assert.equal(changedSettings.revision, beforeSettings.revision + 1);
  const staleSettings = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: beforeSettings.revision, changes: { theme: "light" } }) });
  assert.equal(staleSettings.status, 409);
  assert.deepEqual(await staleSettings.json(), changedSettings);
  assert.deepEqual((await (await fetch(`${base}/api/applications/export`)).json()).settings, changedSettings.settings);
  const failedRestore = await post("/api/applications/import", { ...backup([record("atomic failure")]), settings: { ...settings, boards: [] } });
  assert.equal(failedRestore.status, 400);
  assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), changedSettings);
  assert.equal(await prisma.application.count(), 2, "Invalid settings must not import applications");
  await prisma.$executeRawUnsafe("CREATE TRIGGER reject_settings_restore BEFORE UPDATE ON Settings BEGIN SELECT RAISE(ABORT, 'forced settings failure'); END");
  try {
    const failedWrite = await post("/api/applications/import", backup([{ ...record("rolled back with settings"), archived: false }]));
    assert.equal(failedWrite.status, 500);
    assert.equal(await prisma.application.count(), 2, "A failed settings write must roll back application inserts");
    assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), changedSettings);
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER reject_settings_restore");
  }
  const customizedRestore = await post("/api/applications/import", { ...backup([]), settings: changedSettings.settings });
  assert.equal(customizedRestore.status, 201);
  assert.deepEqual((await (await fetch(`${base}/api/applications/export`)).json()).settings, changedSettings.settings);
  const deleted = await fetch(`${base}/api/applications/${seedId}?undoable=1`, { method: "DELETE", headers: mutationHeaders });
  assert.equal(deleted.status, 200);
  const { token } = await deleted.json();
  assert.ok(token);
  const restoredUndo = await post(`/api/applications/${seedId}/restore`, { token });
  assert.equal(restoredUndo.status, 201);
  const undoRestoredApplication = (await restoredUndo.json()).application;
  assert.equal(undoRestoredApplication.revision, 1, "Undo restore must preserve the internal revision");
  const undoRestoredEvents = await prisma.applicationEvent.findMany({ where: { applicationId: seedId } });
  assert.deepEqual(undoRestoredEvents.map(({ id, fromStatus, toStatus, detail, createdAt }) =>
    [id, fromStatus, toStatus, detail, createdAt.toISOString()]).sort(([left], [right]) => left.localeCompare(right)),
  withEvents.applications[0].events.map(({ id, fromStatus, toStatus, detail, createdAt }) =>
    [id, fromStatus, toStatus, detail, createdAt]).sort(([left], [right]) => left.localeCompare(right)),
    "Delete and undo restore must preserve typed status history");
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token })).status, 404);
  const secondDelete = await fetch(`${base}/api/applications/${seedId}?undoable=1`, { method: "DELETE", headers: mutationHeaders });
  const secondToken = (await secondDelete.json()).token;
  await prisma.application.create({ data: { id: seedId, company: "Collision", role: "Collision", appliedDate: new Date() } });
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 409);
  await prisma.application.delete({ where: { id: seedId } });
  await prisma.undoSnapshot.update({ where: { token: secondToken }, data: { expiresAt: new Date(0) } });
  assert.equal(await prisma.undoSnapshot.count({ where: { token: secondToken } }), 1);
  assert.equal((await fetch(`${base}/api/applications`)).status, 200, "Loading applications must work with expired snapshots");
  assert.equal((await fetch(`${base}/dashboard`)).status, 200, "Rendering a page must work with expired snapshots");
  assert.equal(await prisma.undoSnapshot.count({ where: { token: secondToken } }), 1, "Reads must not clean up expired snapshots");
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 404);

  const restoreCleanupCreated = await post("/api/applications", input("expired restore cleanup"));
  assert.equal(restoreCleanupCreated.status, 201);
  const restoreCleanupApplication = (await restoreCleanupCreated.json()).application;
  const restoreCleanupDelete = await fetch(`${base}/api/applications/${restoreCleanupApplication.id}?undoable=1`, { method: "DELETE", headers: mutationHeaders });
  assert.equal(restoreCleanupDelete.status, 200);
  const restoreCleanupToken = (await restoreCleanupDelete.json()).token;
  await prisma.undoSnapshot.update({ where: { token: restoreCleanupToken }, data: { expiresAt: new Date(0) } });
  assert.equal((await post(`/api/applications/${restoreCleanupApplication.id}/restore`, { token: restoreCleanupToken })).status, 404);
  assert.equal(await prisma.undoSnapshot.count({ where: { token: restoreCleanupToken } }), 0, "Restore requests should purge expired snapshot payloads");

  const deleteCleanupResponse = await post("/api/applications", input("delete cleanup"));
  assert.equal(deleteCleanupResponse.status, 201);
  const deleteCleanupApplication = (await deleteCleanupResponse.json()).application;
  const deleteCleanupToken = randomUUID();
  await prisma.undoSnapshot.create({ data: { token: deleteCleanupToken, applicationId: "expired-delete", payload: "{}", expiresAt: new Date(0) } });
  assert.equal((await fetch(`${base}/api/applications/${deleteCleanupApplication.id}`, { method: "DELETE", headers: mutationHeaders })).status, 204);
  assert.equal(await prisma.undoSnapshot.count({ where: { token: deleteCleanupToken } }), 0, "Delete requests should purge expired snapshot payloads");

  const settingsBeforeCorruption = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  await prisma.settings.update({ where: { id: 1 }, data: { value: '{not json' } });
  const corruptExport = await fetch(`${base}/api/applications/export`);
  assert.equal(corruptExport.status, 200, "Export must survive malformed stored settings");
  assert.ok((await corruptExport.json()).applications.length > 0);
  assert.equal((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value, '{not json', "Read must not rewrite the corrupt row");
  assert.equal((await fetch(`${base}/dashboard`)).status, 200, "Pages must survive malformed stored settings");
  const repair = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders,
    body: JSON.stringify({ revision: settingsBeforeCorruption.revision, changes: { theme: "light" } }) });
  assert.equal(repair.status, 200, "PATCH must repair malformed stored settings");
  assert.equal((await repair.json()).settings.theme, "light");
  assert.equal(JSON.parse((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value).theme, "light");
  await prisma.settings.update({ where: { id: 1 }, data: { value: JSON.stringify({ theme: "neon" }) } });
  assert.equal((await fetch(`${base}/api/applications/export`)).status, 200, "Export must survive schema-invalid stored settings");
  const schemaRepair = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders,
    body: JSON.stringify({ revision: settingsBeforeCorruption.revision + 1, changes: { theme: "dark" } }) });
  assert.equal(schemaRepair.status, 200, "PATCH must repair schema-invalid stored settings");

  // BAK-001: the server clock is behind the latest stored event (clock skew). Import now rejects
  // future-dated events, so the state is seeded directly.
  const skewedInitialAt = new Date(Date.now() + 1500);
  const skewed = await prisma.application.create({ data: {
    company: "Backup API test", role: "clock skew", appliedDate: new Date("2026-09-24T00:00:00.000Z"),
    events: { create: [{ type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: skewedInitialAt }] },
  } });
  const skewedMove = await fetch(`${base}/api/applications/${skewed.id}`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: 0, status: "INTERVIEW" }) });
  assert.equal(skewedMove.status, 200);
  const skewedEvents = await prisma.applicationEvent.findMany({ where: { applicationId: skewed.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(skewedEvents.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]), [[null, "APPLIED"], ["APPLIED", "INTERVIEW"]], "A new status event must sort after the latest existing event");
  assert.ok(skewedEvents[1].createdAt > skewedEvents[0].createdAt);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, skewedEvents[1].createdAt.getTime() - Date.now() + 100)));
  const skewedExport = await (await fetch(`${base}/api/applications/export`)).json();
  assert.ok(skewedExport.applications.some(({ id }) => id === skewed.id));
  const purged = await fetch(`${base}/api/applications/purge`, { method: "DELETE", headers: mutationHeaders, body: "{}" });
  assert.equal(purged.status, 200);
  assert.equal(await prisma.application.count(), 0);
  const skewedReimport = await post("/api/applications/import", skewedExport);
  assert.equal(skewedReimport.status, 201, await skewedReimport.clone().text());
  assert.deepEqual((await (await fetch(`${base}/api/applications/export`)).json()).applications, skewedExport.applications, "Export after a clock-skewed move must round-trip");

  // BAK-001: a history already stored out of order (created before the fix) must still be undo-restorable.
  const outOfOrder = await prisma.application.create({ data: {
    company: "Backup API test", role: "out of order history", status: "INTERVIEW", revision: 3, appliedDate: new Date("2026-09-24T00:00:00.000Z"),
    events: { create: [
      { type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: new Date("2026-09-24T02:00:00.000Z") },
      { type: "STATUS_CHANGE", fromStatus: "APPLIED", toStatus: "INTERVIEW", detail: "APPLIED → INTERVIEW", createdAt: new Date("2026-09-24T01:00:00.000Z") },
    ] },
  }, include: { events: true } });
  const outOfOrderExport = await (await fetch(`${base}/api/applications/export`)).json();
  assert.equal((await post("/api/applications/import", backup(outOfOrderExport.applications.filter(({ id }) => id === outOfOrder.id)))).status, 400, "Import still rejects an out-of-order history");
  const outOfOrderDelete = await fetch(`${base}/api/applications/${outOfOrder.id}?undoable=1`, { method: "DELETE", headers: mutationHeaders });
  assert.equal(outOfOrderDelete.status, 200);
  const outOfOrderRestore = await post(`/api/applications/${outOfOrder.id}/restore`, { token: (await outOfOrderDelete.json()).token });
  assert.equal(outOfOrderRestore.status, 201, await outOfOrderRestore.clone().text());
  const outOfOrderRestored = await prisma.application.findUniqueOrThrow({ where: { id: outOfOrder.id }, include: { events: true } });
  assert.equal(outOfOrderRestored.status, "INTERVIEW");
  assert.equal(outOfOrderRestored.revision, 3);
  const eventRow = ({ id, type, fromStatus, toStatus, detail, createdAt }) => [id, type, fromStatus, toStatus, detail, createdAt.toISOString()];
  assert.deepEqual(outOfOrderRestored.events.map(eventRow).sort(), outOfOrder.events.map(eventRow).sort(), "Undo restore must keep the stored history intact");

  // BAK-001: imported events dated after the import are rejected, not repaired.
  const beforeFutureImport = await prisma.application.count();
  const futureEvent = { ...initial, id: randomUUID(), createdAt: new Date(Date.now() + 86_400_000).toISOString() };
  await assertValidationIssues(await post("/api/applications/import", backup([{ ...record("future event"), archived: false, events: [futureEvent] }])), ["applications[0].events[0].createdAt"]);
  assert.equal(await prisma.application.count(), beforeFutureImport, "A future-dated backup must not create records");

  // ARCH-001: import rejects field values the app itself never stores, and never normalizes them.
  const beforeFieldRules = await prisma.application.count();
  const fieldRuleFailures = [];
  const conforming = () => ({ ...complete, id: randomUUID(), events: [{ ...initial, id: randomUUID() }] });
  const note = (change) => ({ id: randomUUID(), type: "NOTE_ADDED", detail: "Called the recruiter", fromStatus: null, toStatus: null, createdAt: "2026-09-24T01:10:00.000Z", ...change });
  const round = (change) => ({ id: randomUUID(), date: "2026-10-05T00:00:00.000Z", time: null, type: "PHONE", interviewers: null, notes: null, createdAt: "2026-09-24T01:20:00.000Z", ...change });
  const person = (change) => ({ id: randomUUID(), name: "Ana Recruiter", role: null, email: null, linkedinUrl: null, notes: null, createdAt: "2026-09-24T01:25:00.000Z", ...change });
  for (const [path, change] of [
    ["applications[0].appliedDate", { appliedDate: "2026-10-01T00:00:00+06:00" }],
    ["applications[0].appliedDate", { appliedDate: "2026-10-01T15:45:00.000Z" }],
    ["applications[0].appliedDate", { appliedDate: "2026-10-01T00:00:00Z" }],
    ["applications[0].appliedDate", { appliedDate: "2026-02-30T00:00:00.000Z" }],
    ["applications[0].followUpDate", { followUpDate: "2026-10-05T00:00:00+06:00" }],
    ["applications[0].followUpNote", { followUpNote: "A note without a follow-up date" }],
    ["applications[0].followUpNote", { followUpNote: undefined }],
    ["applications[0].interviewDate", { interviewDate: "2026-10-05T00:00:00.000Z" }],
    ["applications[0].interviews", { interviews: undefined }],
    ["applications[0].contacts", { contacts: undefined }],
    ["applications[0].interviews[0].date", { interviews: [round({ date: "2026-10-05T09:00:00.000Z" })] }],
    ["applications[0].interviews[0].time", { interviews: [round({ time: "9:30" })] }],
    ["applications[0].interviews[0].time", { interviews: [round({ time: "24:00" })] }],
    ["applications[0].interviews[0].type", { interviews: [round({ type: "PANEL" })] }],
    ["applications[0].interviews[0].interviewers", { interviews: [round({ interviewers: "" })] }],
    ["applications[0].interviews[0].id", { interviews: [round({ id: "round/1" })] }],
    ["applications[0].contacts[0].name", { contacts: [person({ name: "" })] }],
    ["applications[0].contacts[0].email", { contacts: [person({ email: "not an email" })] }],
    ["applications[0].contacts[0].linkedinUrl", { contacts: [person({ linkedinUrl: "javascript:alert(1)" })] }],
    ["applications[0].events[1]", { events: [{ ...initial, id: randomUUID() }, note({ detail: null })] }],
    ["applications[0].events[1]", { events: [{ ...initial, id: randomUUID() }, note({ detail: " padded " })] }],
    ["applications[0].jobUrl", { jobUrl: "javascript:alert(document.domain)" }],
    ["applications[0].jobUrl", { jobUrl: "data:text/html,<script>alert(1)</script>" }],
    ["applications[0].jobUrl", { jobUrl: "ftp://example.test/job" }],
    ["applications[0].jobUrl", { jobUrl: "not a url" }],
    ["applications[0].jobUrl", { jobUrl: "  https://example.test/job  " }],
    ["applications[0].jobUrl", { jobUrl: "" }],
    ["applications[0].source", { source: "" }],
    ["applications[0].source", { source: " Referral" }],
    ["applications[0].notes", { notes: "   " }],
    ["applications[0].company", { company: " Padded company" }],
    ["applications[0].id", { id: "a/b" }],
    ["applications[0].id", { id: "x?undoable=1" }],
    ["applications[0].id", { id: "x".repeat(65) }],
    ["applications[0].id", { id: "export" }],
    ["applications[0].id", { id: "purge" }],
    ["applications[0].events[1].id", { events: [{ ...initial, id: randomUUID() }, note({ id: "event/1" })] }],
    ["applications[0].events[1].detail", { events: [{ ...initial, id: randomUUID() }, note({ detail: "x".repeat(5_001) })] }],
    ["applications[0].events[1].emailSnippet", { events: [{ ...initial, id: randomUUID() }, note({ emailSnippet: null })] }],
  ]) {
    const response = await post("/api/applications/import", backup([{ ...conforming(), ...change }]));
    if (response.status !== 400) {
      fieldRuleFailures.push(`${JSON.stringify(change).slice(0, 80)} → ${response.status}`);
      continue;
    }
    await assertValidationIssues(response, [path]);
  }
  assert.deepEqual(fieldRuleFailures, [], "Non-conforming import values must be rejected");
  assert.equal(await prisma.application.count(), beforeFieldRules, "Rejected field values must not create records");
  const fullyPopulated = {
    ...conforming(), source: "Referral", notes: "Kept as written", jobUrl: "https://example.test/job?id=1",
    appliedDate: "2026-09-01T00:00:00.000Z", followUpDate: "2026-10-07T00:00:00.000Z", followUpNote: "Ask about the team",
    interviews: [round({ time: "14:30", interviewers: "Ana and Ben", notes: "System design" }), round({ type: "ONSITE" })],
    contacts: [person({ role: "Recruiter", email: "ana@example.test", linkedinUrl: "https://www.linkedin.com/in/ana", notes: "Prefers email" })],
    createdAt: "2026-09-24T07:00:00+06:00", lastUpdated: "2026-09-24T08:00:00+06:00",
  };
  fullyPopulated.events.push(note({ detail: "x".repeat(5_000), createdAt: "2026-09-24T07:10:00+06:00" }));
  const fullyPopulatedImport = await post("/api/applications/import", backup([fullyPopulated]));
  assert.equal(fullyPopulatedImport.status, 201, await fullyPopulatedImport.clone().text());
  const storedPopulated = (await (await fetch(`${base}/api/applications/export`)).json()).applications.find(({ id }) => id === fullyPopulated.id);
  assert.equal(storedPopulated.createdAt, "2026-09-24T01:00:00.000Z", "Timestamps keep accepting offsets");
  assert.equal(storedPopulated.appliedDate, fullyPopulated.appliedDate);
  assert.equal(storedPopulated.followUpDate, fullyPopulated.followUpDate);
  assert.equal(storedPopulated.followUpNote, fullyPopulated.followUpNote);
  const byId = (left, right) => left.id.localeCompare(right.id);
  assert.deepEqual([...storedPopulated.interviews].sort(byId), [...fullyPopulated.interviews].sort(byId), "Interview rounds round-trip exactly");
  assert.deepEqual(storedPopulated.contacts, fullyPopulated.contacts, "Contacts round-trip exactly");
  const duplicateRound = await post("/api/applications/import", backup([{ ...conforming(), interviews: [fullyPopulated.interviews[0]] }]));
  assert.equal(duplicateRound.status, 409, "An interview ID that already exists stops the import");
  const changedChild = await post("/api/applications/import", backup([{ ...storedPopulated, contacts: [{ ...storedPopulated.contacts[0], notes: "Changed" }] }]));
  assert.equal(changedChild.status, 409, "A changed contact counts as a conflicting record");
  assert.equal(storedPopulated.events.find(({ type }) => type === "NOTE_ADDED").detail.length, 5_000);
  assert.equal((await post("/api/applications/import", backup([storedPopulated]))).status, 201, "A conforming export re-imports as an identical record");

  // ARCH-001: a stored row that predates the stricter import rules still gets conflict detection, not a 400.
  const legacy = await prisma.application.create({ data: {
    company: "Backup API test", role: "legacy row", source: "", notes: "   ", jobUrl: "javascript:alert(1)",
    appliedDate: new Date("2026-09-30T18:00:00.000Z"), createdAt: new Date("2026-09-24T01:00:00.000Z"),
    events: { create: [
      { type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: new Date("2026-09-24T02:00:00.000Z") },
      { type: "STATUS_CHANGE", fromStatus: "APPLIED", toStatus: "INTERVIEW", detail: "APPLIED → INTERVIEW", createdAt: new Date("2026-09-24T01:00:00.000Z") },
    ] },
  } });
  const legacyConflict = await post("/api/applications/import", backup([{ ...conforming(), id: legacy.id }]));
  assert.equal(legacyConflict.status, 409, await legacyConflict.clone().text());
  assert.deepEqual((await legacyConflict.json()).conflicts, [legacy.id]);
  console.log("Passed: version 1 backup round trip, outdated backup rejection, identical merge, conflicts, malformed atomicity, settings-only import, one-time restore, expiry enforcement and mutation cleanup, corrupt settings recovery, collision, invalid status, chunked size limit, clock-skewed status events, out-of-order undo restore, future-dated import rejection, shared import field rules, legacy-row conflict detection.");
} finally { await prisma.$disconnect(); }
