import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const prisma = new PrismaClient();
const headers = { Origin: new URL(base).origin, "Content-Type": "application/json" };
const settings = { theme: "system", defaultBoard: "APPLIED", startupPage: "dashboard", staleApplicationThreshold: 15,
  motion: "system", boards: [], sidebarCollapsed: false, archivedExpanded: false, allApplicationsExpanded: true };
const date = "2026-09-24T00:00:00.000Z";
const records = Array.from({ length: 2_000 }, (_, index) => ({
  id: randomUUID(), company: "Contention test", role: `Role ${index}`, status: "APPLIED", source: null,
  appliedDate: date, interviewDate: null, interviewDatePromptDismissed: false, archived: false, notes: null, jobUrl: null,
  createdAt: date, lastUpdated: date,
  events: [{ id: randomUUID(), type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED",
    detail: "null → APPLIED", emailSnippet: null, createdAt: date }],
}));

try {
  assert.equal((await fetch(`${base}/dashboard`)).status, 200, "Warm page route before the import probe");
  const started = Date.now();
  let importSettled = false;
  const importing = fetch(`${base}/api/applications/import`, { method: "POST", headers,
    body: JSON.stringify({ version: 1, applications: records, settings }) }).then((response) => {
    importSettled = true;
    return response;
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(importSettled, false, "Import must still be running when read probes begin");
  const [list, page] = await Promise.all([
    fetch(`${base}/api/applications`), fetch(`${base}/dashboard`),
  ]);
  assert.equal(list.status, 200, `List GET during import: ${list.status}`);
  assert.equal(page.status, 200, `Page GET during import: ${page.status}`);
  await Promise.all([list.arrayBuffer(), page.arrayBuffer()]);
  const imported = await importing;
  assert.equal(imported.status, 201, `Import status ${imported.status}: ${(await imported.clone().text()).slice(0, 600)}`);
  const result = await imported.json();
  assert.equal(result.createdIds.length, records.length);
  assert.equal(await prisma.application.count(), records.length);
  const importMs = Date.now() - started;

  const id = records[0].id;
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/api/applications/${id}`, {
    method: "PATCH", headers, body: JSON.stringify({ revision: 0, status: "INTERVIEW" }),
  })));
  const statuses = responses.map((response) => response.status);
  assert.ok(statuses.every((status) => status === 200 || status === 409), `Unexpected PATCH statuses: ${statuses.join(", ")}`);
  assert.equal(statuses.filter((status) => status === 200).length, 1);
  const final = await prisma.application.findUniqueOrThrow({ where: { id }, include: { events: true } });
  assert.equal(final.revision, 1);
  assert.equal(final.events.length, 2);

  const settingsRow = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  await prisma.settings.update({ where: { id: 1 }, data: { value: '{not json' } });
  const exportResponse = await fetch(`${base}/api/applications/export`);
  assert.equal(exportResponse.status, 200, "Export must survive corrupt persisted settings");
  assert.equal((await exportResponse.json()).applications.length, records.length);
  assert.equal((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value, '{not json', "Export must not repair settings on read");
  const repair = await fetch(`${base}/api/settings`, { method: "PATCH", headers,
    body: JSON.stringify({ revision: settingsRow.revision, changes: { theme: "dark" } }) });
  assert.equal(repair.status, 200, "Settings PATCH must repair corrupt persisted settings");
  assert.equal(JSON.parse((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value).theme, "dark");

  const deleted = await fetch(`${base}/api/applications/${id}?undoable=1`, { method: "DELETE", headers });
  assert.equal(deleted.status, 200);
  const { token } = await deleted.json();
  await prisma.undoSnapshot.update({ where: { token }, data: { expiresAt: new Date(0) } });
  assert.equal((await fetch(`${base}/api/applications`)).status, 200);
  assert.equal((await fetch(`${base}/dashboard`)).status, 200);
  assert.equal(await prisma.undoSnapshot.count({ where: { token } }), 1, "Reads must not clean expired snapshots");
  const expiredRestore = await fetch(`${base}/api/applications/${id}/restore`, { method: "POST", headers,
    body: JSON.stringify({ token }) });
  assert.equal(expiredRestore.status, 404, "Expired snapshots must not be restorable");

  let lockAcquired;
  const acquired = new Promise((resolve) => { lockAcquired = resolve; });
  const heldWrite = prisma.$transaction(async (tx) => {
    await tx.settings.update({ where: { id: 1 }, data: { value: JSON.stringify(settings) } });
    lockAcquired();
    await new Promise((resolve) => setTimeout(resolve, 16_000));
  }, { timeout: 25_000 });
  await acquired;
  const lockedPatch = await fetch(`${base}/api/settings`, { method: "PATCH", headers,
    body: JSON.stringify({ revision: settingsRow.revision + 1, changes: { theme: "light" } }) });
  await heldWrite;
  assert.equal(lockedPatch.status, 503, "A temporary SQLite write lock must return 503");
  assert.equal(lockedPatch.headers.get("retry-after"), "1");

  console.log(JSON.stringify({ importRecords: records.length, importMs, listStatus: list.status,
    pageStatus: page.status, patchStatuses: statuses, exportStatus: exportResponse.status,
    repairStatus: repair.status, expiredRestoreStatus: expiredRestore.status, lockedPatchStatus: lockedPatch.status }));
} finally {
  await prisma.$disconnect();
}
