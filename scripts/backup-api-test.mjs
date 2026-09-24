import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const prisma = new PrismaClient();
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const input = (role) => ({ company: "Backup API test", role, status: "APPLIED", appliedDate: "2026-09-24" });
const settings = { theme: "system", defaultBoard: "APPLIED", motion: "system", boards: [], sidebarCollapsed: false, archivedExpanded: false };
const backup = (applications) => ({ version: 2, applications, settings });
const record = (role) => ({ id: randomUUID(), company: "Backup API test", role, status: "APPLIED", source: null,
  appliedDate: "2026-09-24T00:00:00.000Z", interviewDate: null, interviewDatePromptDismissed: true,
  notes: "Preserved note", jobUrl: null, createdAt: "2026-09-24T01:00:00.000Z", lastUpdated: "2026-09-24T02:00:00.000Z",
  events: [{ id: randomUUID(), type: "STATUS_CHANGE", detail: "ONLINE_ASSESSMENT → APPLIED", emailSnippet: null, createdAt: "2026-09-24T01:30:00.000Z" }] });

try {
  assert.equal((await post("/api/applications", input("seed"))).status, 201);
  const invalidStatus = await fetch(`${base}/api/applications/missing`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "INVALID" }) });
  console.log(`Invalid status PATCH: ${invalidStatus.status} ${await invalidStatus.text()}`);
  assert.equal(invalidStatus.status, 400);
  const forged = await fetch(`${base}/api/applications`, { headers: { "x-forwarded-for": "203.0.113.19" } });
  assert.equal(forged.status, 200);
  const exported = await (await fetch(`${base}/api/applications/export`)).json();
  assert.equal(exported.version, 2);
  assert.deepEqual(exported.settings, settings);
  assert.equal(exported.applications.length, 1);
  const seedId = exported.applications[0].id;
  const moved = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "INTERVIEW" }) });
  assert.equal(moved.status, 200);
  const archived = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).application.status, "INTERVIEW");
  const withEvents = await (await fetch(`${base}/api/applications/export`)).json();
  assert.equal(withEvents.applications[0].events.length, 1);
  assert.equal(withEvents.applications[0].archived, true);
  assert.equal((await fetch(`${base}/api/applications/${seedId}`, { method: "DELETE" })).status, 204);
  const restored = await post("/api/applications/import", withEvents);
  assert.equal(restored.status, 201, await restored.clone().text());
  assert.deepEqual((await restored.json()).createdIds, [seedId]);
  const roundTrip = await (await fetch(`${base}/api/applications/export`)).json();
  assert.deepEqual(roundTrip.applications, withEvents.applications);
  const identical = await post("/api/applications/import", backup(withEvents.applications));
  assert.equal(identical.status, 201);
  assert.deepEqual((await identical.json()).skippedIds, [seedId]);
  assert.equal((await post("/api/applications/import", backup([{ ...withEvents.applications[0], role: "conflict" }]))).status, 409);
  assert.equal((await post("/api/applications/import", backup([{ ...record("invalid status"), status: "INVALID" }]))).status, 400);
  assert.equal((await post("/api/applications/import", backup([record("good"), { ...record("bad"), appliedDate: "invalid" }]))).status, 400);
  assert.equal(await prisma.application.count(), 1);
  assert.equal((await post("/api/applications/import", { version: 1, applications: [] })).status, 400);
  assert.equal((await post("/api/applications/import", [])).status, 400);
  assert.equal((await post("/api/applications/import", backup([]))).status, 201);
  const deleted = await fetch(`${base}/api/applications/${seedId}?undoable=1`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const { token } = await deleted.json();
  assert.ok(token);
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token })).status, 201);
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token })).status, 404);
  const secondDelete = await fetch(`${base}/api/applications/${seedId}?undoable=1`, { method: "DELETE" });
  const secondToken = (await secondDelete.json()).token;
  await prisma.application.create({ data: { id: seedId, company: "Collision", role: "Collision", appliedDate: new Date() } });
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 409);
  await prisma.application.delete({ where: { id: seedId } });
  await prisma.undoSnapshot.update({ where: { token: secondToken }, data: { expiresAt: new Date(0) } });
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 404);
  console.log("Passed: backup round trip, identical merge, conflicts, malformed atomicity, unsupported versions, settings-only import, token reuse/expiry/collision, invalid status.");
} finally { await prisma.$disconnect(); }
