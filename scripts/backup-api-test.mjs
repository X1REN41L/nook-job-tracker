import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const origin = new URL(base).origin;
const mutationHeaders = { Origin: origin, "Content-Type": "application/json" };
const prisma = new PrismaClient();
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(body) });
const input = (role) => ({ company: "Backup API test", role, status: "APPLIED", appliedDate: "2026-09-24" });
const settings = { theme: "system", defaultBoard: "APPLIED", motion: "system", boards: [], sidebarCollapsed: false, archivedExpanded: false };
const backup = (applications) => ({ version: 2, applications, settings });
const record = (role) => ({ id: randomUUID(), company: "Backup API test", role, status: "APPLIED", source: null,
  appliedDate: "2026-09-24T00:00:00.000Z", interviewDate: null, interviewDatePromptDismissed: true,
  notes: "Preserved note", jobUrl: null, createdAt: "2026-09-24T01:00:00.000Z", lastUpdated: "2026-09-24T02:00:00.000Z",
  events: [{ id: randomUUID(), type: "STATUS_CHANGE", detail: "ONLINE_ASSESSMENT → APPLIED", emailSnippet: null, createdAt: "2026-09-24T01:30:00.000Z" }] });
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
    method: "PUT", headers: mutationHeaders, body: JSON.stringify({ ...input("invalid edit"), revision: application.revision, role: "" }),
  }), ["role"]);
  const forged = await fetch(`${base}/api/applications`, { headers: { "x-forwarded-for": "203.0.113.19" } });
  assert.equal(forged.status, 200);
  const exported = await (await fetch(`${base}/api/applications/export`)).json();
  assert.equal(exported.version, 2);
  assert.deepEqual(exported.settings, settings);
  assert.equal(exported.applications.length, 1);
  assert.equal("revision" in exported.applications[0], false, "Backup v2 exports must not include application revisions");
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
  assert.equal(withEvents.applications[0].events.length, 1);
  assert.equal(withEvents.applications[0].archived, true);
  assert.equal((await fetch(`${base}/api/applications/${seedId}`, { method: "DELETE", headers: mutationHeaders })).status, 204);
  const restored = await post("/api/applications/import", withEvents);
  assert.equal(restored.status, 201, await restored.clone().text());
  const importResult = await restored.json();
  assert.deepEqual(importResult.createdIds, [seedId]);
  assert.equal(importResult.applications[0].revision, 0, "Backup v2 import should start at the database default revision");
  const roundTrip = await (await fetch(`${base}/api/applications/export`)).json();
  assert.deepEqual(roundTrip.applications, withEvents.applications);
  const identical = await post("/api/applications/import", backup(withEvents.applications));
  assert.equal(identical.status, 201);
  assert.deepEqual((await identical.json()).skippedIds, [seedId]);
  assert.equal((await post("/api/applications/import", backup([{ ...withEvents.applications[0], role: "conflict" }]))).status, 409);
  await assertValidationIssues(await post("/api/applications/import", backup([
    { ...record("invalid status"), status: "INVALID" },
    { ...record("invalid fields"), company: "", appliedDate: "invalid" },
  ])), ["applications[0].status", "applications[1].company", "applications[1].appliedDate"]);
  assert.equal(await prisma.application.count(), 1);
  const changedForUndo = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: 0, archived: false }) });
  assert.equal(changedForUndo.status, 200);
  assert.equal((await changedForUndo.json()).application.revision, 1);
  assert.equal((await post("/api/applications/import", { version: 1, applications: [] })).status, 400);
  assert.equal((await post("/api/applications/import", [])).status, 400);
  assert.equal((await post("/api/applications/import", backup([]))).status, 201);
  const deleted = await fetch(`${base}/api/applications/${seedId}?undoable=1`, { method: "DELETE", headers: mutationHeaders });
  assert.equal(deleted.status, 200);
  const { token } = await deleted.json();
  assert.ok(token);
  const restoredUndo = await post(`/api/applications/${seedId}/restore`, { token });
  assert.equal(restoredUndo.status, 201);
  assert.equal((await restoredUndo.json()).application.revision, 1, "Undo restore must preserve the internal revision");
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token })).status, 404);
  const secondDelete = await fetch(`${base}/api/applications/${seedId}?undoable=1`, { method: "DELETE", headers: mutationHeaders });
  const secondToken = (await secondDelete.json()).token;
  await prisma.application.create({ data: { id: seedId, company: "Collision", role: "Collision", appliedDate: new Date() } });
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 409);
  await prisma.application.delete({ where: { id: seedId } });
  await prisma.undoSnapshot.update({ where: { token: secondToken }, data: { expiresAt: new Date(0) } });
  assert.equal(await prisma.undoSnapshot.count({ where: { token: secondToken } }), 1);
  assert.equal((await fetch(`${base}/api/applications`)).status, 200, "Loading applications should trigger expired snapshot cleanup");
  assert.equal(await prisma.undoSnapshot.count({ where: { token: secondToken } }), 0, "Expired snapshot payload should be deleted on application load");
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
  console.log("Passed: backup round trip, identical merge, conflicts, malformed atomicity, unsupported versions, settings-only import, one-time restore, expiry cleanup on load/delete/restore, collision, invalid status.");
} finally { await prisma.$disconnect(); }
