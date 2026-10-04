import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const origin = new URL(base).origin;
const mutationHeaders = { Origin: origin, "Content-Type": "application/json" };
const prisma = new PrismaClient();
const post = async (path, body) => {
  if (path === "/api/applications/import") {
    const upload = await fetch(`${base}${path}/upload`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(body) });
    if (!upload.ok) return upload;
    const { token } = await upload.json();
    body = { token };
  }
  return fetch(`${base}${path}`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(body) });
};
async function exportResponse() {
  const prepared = await fetch(`${base}/api/applications/export`, { method: "POST", headers: mutationHeaders });
  if (!prepared.ok) return prepared;
  const { token } = await prepared.json();
  const response = await fetch(`${base}/api/applications/export?token=${token}`);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Disposition"), /^attachment;/);
  return response;
}
async function deleteApplication(id, undoable = false) {
  const current = await fetch(`${base}/api/applications/${id}`);
  assert.equal(current.status, 200);
  const { application } = await current.json();
  return fetch(`${base}/api/applications/${id}${undoable ? "?undoable=1" : ""}`, {
    method: "DELETE", headers: mutationHeaders, body: JSON.stringify({ revision: application.revision }),
  });
}
async function bulkTargets(ids) {
  return Promise.all(ids.map(async (id) => {
    const current = await fetch(`${base}/api/applications/${id}`);
    if (current.status === 404) return { id, revision: 0 };
    assert.equal(current.status, 200);
    return { id, revision: (await current.json()).application.revision };
  }));
}
const input = (role) => ({ company: "Backup API test", role, status: "APPLIED", appliedDate: "2026-09-24" });
const settings = { theme: "system", startupPage: "dashboard", staleApplicationThreshold: 15, motion: "system", timeFormat: "system", weekStart: "system", sidebarCollapsed: false, archivedExpanded: false };
const backup = (applications) => ({ version: 1, applications, settings });
const record = (role) => ({ id: randomUUID(), company: "Backup API test", role, status: "APPLIED", archived: false, source: null,
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

async function assertImportRejection(response, field = "backup") {
  assert.equal(response.status, 400, field);
  const body = await response.json();
  assert.deepEqual(body, { error: "Unsupported or invalid Nook version 1 backup" }, field);
}

async function verifyDeletionRevisions() {
  const create = async (role) => {
    const response = await post("/api/applications", input(role));
    assert.equal(response.status, 201);
    return (await response.json()).application;
  };
  const sendDelete = (id, revision, undoable = false) => fetch(`${base}/api/applications/${id}${undoable ? "?undoable=1" : ""}`, {
    method: "DELETE", headers: mutationHeaders, body: JSON.stringify({ revision }),
  });
  const missing = randomUUID();
  for (const undoable of [false, true]) assert.equal((await sendDelete(missing, 0, undoable)).status, 404);
  const validation = await create("delete validation");
  for (const undoable of [false, true]) {
    const path = `${base}/api/applications/${validation.id}${undoable ? "?undoable=1" : ""}`;
    for (const body of [undefined, "{invalid", "{}", '{"revision":-1}', '{"revision":0.5}', '{"revision":"0"}', '{"revision":0,"extra":1}']) {
      assert.equal((await fetch(path, { method: "DELETE", headers: mutationHeaders, body })).status, 400);
    }
  }
  for (const body of [{ ids: [validation.id] }, { applications: [] },
    { applications: [{ id: validation.id }] }, { applications: [{ id: validation.id, revision: -1 }] },
    { applications: [{ id: validation.id, revision: 0.5 }] }, { applications: [{ id: validation.id, revision: "0" }] },
    { applications: [{ id: validation.id, revision: 0, extra: true }] },
    { applications: [{ id: validation.id, revision: 0 }, { id: validation.id, revision: 1 }] },
    { applications: Array.from({ length: 1001 }, (_, i) => ({ id: `too-many-${i}`, revision: 0 })) }]) {
    assert.equal((await post("/api/applications/bulk-delete", body)).status, 400);
  }
  await deleteApplication(validation.id);

  for (const kind of ["details", "contacts", "interviews", "notes", "status"]) {
    const original = await create(`stale delete ${kind}`);
    const partner = await create(`stale delete partner ${kind}`);
    const path = `/api/applications/${original.id}`;
    const [method, suffix, fields] = kind === "details" ? ["PUT", "", { company: original.company, role: "New details", appliedDate: "2026-09-24" }]
      : kind === "contacts" ? ["POST", "/contacts", { name: "New contact" }]
      : kind === "interviews" ? ["POST", "/interviews", { date: "2026-09-25", type: "OTHER" }]
      : kind === "notes" ? ["POST", "/notes", { text: "New note" }]
      : ["PATCH", "", { status: "REJECTED" }];
    const changed = await fetch(`${base}${path}${suffix}`, { method, headers: mutationHeaders, body: JSON.stringify({ ...fields, revision: original.revision }) });
    assert.ok(changed.ok, await changed.clone().text());
    const latest = (await changed.json()).application;
    assert.equal(latest.revision, original.revision + 1);
    const before = await prisma.application.findMany({ where: { id: { in: [original.id, partner.id] } }, include: { events: true, contacts: true, interviews: true }, orderBy: { id: "asc" } });
    const snapshots = await prisma.undoSnapshot.findMany();
    const settingsBefore = await prisma.settings.findMany();
    for (const undoable of [false, true]) {
      const conflict = await sendDelete(original.id, original.revision, undoable);
      assert.equal(conflict.status, 409, kind);
      const body = await conflict.json();
      assert.equal(body.application.revision, latest.revision);
      assert.equal(body.application.id, original.id);
      assert.ok(Array.isArray(body.application.contacts));
      assert.ok(Array.isArray(body.application.interviews));
    }
    const bulk = await post("/api/applications/bulk-delete", { applications: [
      { id: partner.id, revision: partner.revision }, { id: missing, revision: 0 }, { id: original.id, revision: original.revision },
    ] });
    assert.equal(bulk.status, 409, kind);
    assert.deepEqual((await bulk.json()).applications.map(({ id, revision }) => ({ id, revision })), [{ id: original.id, revision: latest.revision }]);
    assert.deepEqual(await prisma.application.findMany({ where: { id: { in: [original.id, partner.id] } }, include: { events: true, contacts: true, interviews: true }, orderBy: { id: "asc" } }), before);
    assert.deepEqual(await prisma.undoSnapshot.findMany(), snapshots, "Conflicts must not create recovery snapshots");
    assert.deepEqual(await prisma.settings.findMany(), settingsBefore);
    await deleteApplication(original.id);
    await deleteApplication(partner.id);
  }

  const staleTargets = await Promise.all([create("multiple stale left"), create("multiple stale right")]);
  for (const application of staleTargets) {
    const updated = await fetch(`${base}/api/applications/${application.id}`, {
      method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: application.revision, archived: true }),
    });
    assert.equal(updated.status, 200);
  }
  const multipleConflict = await post("/api/applications/bulk-delete", {
    applications: staleTargets.map(({ id, revision }) => ({ id, revision })),
  });
  assert.equal(multipleConflict.status, 409);
  assert.deepEqual((await multipleConflict.json()).applications.map(({ id }) => id).sort(), staleTargets.map(({ id }) => id).sort(), "Every changed target must be returned");
  for (const application of staleTargets) await deleteApplication(application.id);

  const batch = Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), company: "Bulk revision bound", role: `Target ${i}`, appliedDate: new Date("2026-09-24T00:00:00.000Z") }));
  await prisma.application.createMany({ data: batch });
  const applications = batch.map(({ id }) => ({ id, revision: 0 }));
  await prisma.$executeRawUnsafe("CREATE TRIGGER reject_bulk_delete BEFORE DELETE ON Application WHEN OLD.company = 'Bulk revision bound' AND (SELECT COUNT(*) FROM Application WHERE company = 'Bulk revision bound') < 100 BEGIN SELECT RAISE(ABORT, 'injected late deletion failure'); END");
  const beforeSnapshots = await prisma.undoSnapshot.count();
  try {
    assert.equal((await post("/api/applications/bulk-delete", { applications })).status, 500);
    assert.equal(await prisma.application.count({ where: { id: { in: batch.map(({ id }) => id) } } }), 1000, "A late deletion failure must roll back earlier batches");
    assert.equal(await prisma.undoSnapshot.count(), beforeSnapshots, "Snapshot writes must roll back with deletion");
  } finally { await prisma.$executeRawUnsafe("DROP TRIGGER reject_bulk_delete"); }
  const deleted = await post("/api/applications/bulk-delete", { applications });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const result = await deleted.json();
  assert.equal(result.deletedIds.length, 1000);
  assert.equal(await prisma.undoSnapshot.count(), beforeSnapshots + 1000);
  await prisma.undoSnapshot.deleteMany({ where: { token: { startsWith: `${result.token}:` } } });
  const gone = await post("/api/applications/bulk-delete", { applications: [{ id: missing, revision: 42 }] });
  assert.equal(gone.status, 200);
  assert.deepEqual((await gone.json()).deletedIds, []);
  console.log("Passed deletion revisions: strict bodies, both individual modes, all five mutation categories, atomic stale bulk rejection, 1,000-target bound, late-failure rollback, and missing targets.");
}

async function verifySnapshotInvalidation() {
  const importRecords = async (records) => {
    const response = await post("/api/applications/import", backup(records));
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const snapshotRows = () => prisma.undoSnapshot.findMany({ orderBy: { token: "asc" } });
  const holdSnapshots = async (application, batch = randomUUID()) => {
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: application.id }, include: { events: true, interviews: true, contacts: true } });
    const rows = [randomUUID(), randomUUID(), `${batch}:${application.id}`].map((token) => ({
      token, applicationId: application.id, payload: JSON.stringify(stored), expiresAt: new Date(Date.now() + 600_000),
    }));
    await prisma.undoSnapshot.createMany({ data: rows });
    return rows;
  };
  const individual = record("individual old token");
  const first = record("bulk old token one");
  const second = record("bulk old token two");
  const unrelated = record("unrelated recovery");
  await importRecords([individual, first, second, unrelated]);
  const unrelatedToken = (await (await deleteApplication(unrelated.id, true)).json()).token;
  const unrelatedSnapshot = await prisma.undoSnapshot.findUniqueOrThrow({ where: { token: unrelatedToken } });

  // The exact SEC-03 sequence, including an unrelated recoverable application.
  const oldToken = (await (await deleteApplication(individual.id, true)).json()).token;
  assert.equal((await importRecords([individual])).created, 1);
  assert.equal(await prisma.undoSnapshot.count({ where: { applicationId: individual.id } }), 0);
  assert.equal((await deleteApplication(individual.id)).status, 204);
  assert.equal((await post(`/api/applications/${individual.id}/restore`, { token: oldToken })).status, 404);
  assert.equal(await prisma.application.count({ where: { id: individual.id } }), 0);

  const bulkDeleted = await post("/api/applications/bulk-delete", { applications: await bulkTargets([first.id, second.id]) });
  assert.equal(bulkDeleted.status, 200);
  const batch = await bulkDeleted.json();
  assert.equal((await importRecords([first])).created, 1);
  assert.equal(await prisma.undoSnapshot.count({ where: { applicationId: first.id } }), 0);
  const survivingBatchSnapshot = await prisma.undoSnapshot.findUniqueOrThrow({ where: { token: `${batch.token}:${second.id}` } });
  assert.equal((await deleteApplication(first.id)).status, 204);
  assert.equal((await post("/api/applications/bulk-restore", { token: batch.token, ids: batch.deletedIds })).status, 404);
  assert.equal(await prisma.application.count({ where: { id: { in: batch.deletedIds } } }), 0, "Invalidated bulk restore must restore none of its targets");
  assert.deepEqual(await prisma.undoSnapshot.findUnique({ where: { token: `${batch.token}:${second.id}` } }), survivingBatchSnapshot);

  // Direct permanent deletion removes every historical individual and batch row.
  const permanent = record("permanent invalidation");
  await importRecords([permanent]);
  const rows = await holdSnapshots(permanent);
  const held = await snapshotRows();
  const staleDelete = await fetch(`${base}/api/applications/${permanent.id}`, { method: "DELETE", headers: mutationHeaders, body: JSON.stringify({ revision: 999 }) });
  assert.equal(staleDelete.status, 409);
  assert.deepEqual(await snapshotRows(), held, "Revision conflict must not invalidate recovery snapshots");
  await prisma.$executeRawUnsafe(`CREATE TRIGGER step6_reject_invalidation BEFORE DELETE ON UndoSnapshot WHEN OLD.applicationId = '${permanent.id}' BEGIN SELECT RAISE(ABORT, 'injected snapshot invalidation failure'); END`);
  try {
    assert.equal((await deleteApplication(permanent.id)).status, 500);
    assert.equal(await prisma.application.count({ where: { id: permanent.id } }), 1, "Failed snapshot invalidation must roll back permanent deletion");
    assert.deepEqual(await snapshotRows(), held);
  } finally { await prisma.$executeRawUnsafe("DROP TRIGGER step6_reject_invalidation"); }
  assert.equal((await deleteApplication(permanent.id)).status, 204);
  assert.equal(await prisma.undoSnapshot.count({ where: { applicationId: permanent.id } }), 0);
  for (const row of rows.slice(0, 2)) assert.equal((await post(`/api/applications/${permanent.id}/restore`, { token: row.token })).status, 404);
  assert.equal((await post("/api/applications/bulk-restore", { token: rows[2].token.split(":")[0], ids: [permanent.id] })).status, 404);

  // Only newly created IDs invalidate snapshots: identical/skipped imports preserve them.
  const skipped = record("skipped import snapshots");
  await importRecords([skipped]);
  const skippedRows = await holdSnapshots(skipped);
  const beforeSkip = await snapshotRows();
  assert.equal((await importRecords([skipped])).skipped, 1);
  assert.deepEqual(await snapshotRows(), beforeSkip);
  const undoableDelete = await deleteApplication(skipped.id, true);
  assert.equal(undoableDelete.status, 200);
  assert.equal(await prisma.undoSnapshot.count({ where: { applicationId: skipped.id } }), skippedRows.length + 1, "Undoable deletion preserves prior snapshots");
  assert.equal((await importRecords([skipped])).created, 1);
  assert.equal(await prisma.undoSnapshot.count({ where: { applicationId: skipped.id } }), 0, "Recreation invalidates all individual and bulk snapshots");
  assert.deepEqual(await prisma.undoSnapshot.findUnique({ where: { token: unrelatedToken } }), unrelatedSnapshot);
  assert.equal((await post(`/api/applications/${unrelated.id}/restore`, { token: unrelatedToken })).status, 201);
  assert.equal((await post("/api/applications/bulk-restore", { token: batch.token, ids: [second.id] })).status, 201, "An unrelated retained batch member remains recoverable");
  console.log("Passed SEC-03: individual/bulk old-token sequences, all matching snapshots, atomic bulk rejection, unrelated recovery, stale-delete preservation, permanent-delete rollback, skipped imports, and undoable deletion.");
}

try {
  await verifyDeletionRevisions();
  const baselineCount = await prisma.application.count();
  const malformedCommit = await fetch(`${base}/api/applications/import`, { method: "POST", headers: mutationHeaders, body: "{invalid" });
  assert.equal(malformedCommit.status, 400);
  assert.equal((await malformedCommit.json()).error, "Request body must be valid JSON");
  const unknownCommit = await fetch(`${base}/api/applications/import`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ token: "a".repeat(64) }) });
  assert.equal(unknownCommit.status, 404);
  const oversized = await fetch(`${base}/api/applications/import`, {
    method: "POST", headers: mutationHeaders, body: " ".repeat(256 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /256 KiB/);
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
  assert.equal(oversizedChunkedStatus, 413, "Chunked bodies over 256 KiB must reach the route's own size limit");
  assert.equal(await prisma.application.count(), baselineCount, "Oversized chunked request must not create records");

  const tooManyApplications = await post("/api/applications/import", backup(Array(5_001).fill(null)));
  assert.equal(tooManyApplications.status, 400);
  assert.equal(await prisma.application.count(), baselineCount, "Invalid application entries must not create records");

  const malformedJson = await fetch(`${base}/api/applications/import/upload`, {
    method: "POST", headers: mutationHeaders, body: "{not json",
  });
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json()).error, "Unsupported or invalid Nook version 1 backup");
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
  const exported = await (await exportResponse()).json();
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
  const withEvents = await (await exportResponse()).json();
  assert.equal(withEvents.applications[0].events.length, 2, "A created application keeps its initial status event");
  assert.ok(withEvents.applications[0].events.some(({ fromStatus, toStatus }) => fromStatus === null && toStatus === "APPLIED"));
  assert.ok(withEvents.applications[0].events.some(({ fromStatus, toStatus }) => fromStatus === "APPLIED" && toStatus === "INTERVIEW"));
  assert.equal(withEvents.applications[0].archived, true);
  const undoBeforePlainDelete = await prisma.undoSnapshot.count();
  assert.equal((await deleteApplication(seedId)).status, 204);
  assert.equal(await prisma.undoSnapshot.count(), undoBeforePlainDelete, "Plain DELETE is permanent and does not create an undo snapshot");
  const restored = await post("/api/applications/import", withEvents);
  assert.equal(restored.status, 201, await restored.clone().text());
  const importResult = await restored.json();
  assert.equal(importResult.created, 1);
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: seedId } })).revision, 0, "Backup import should start at the database default revision");
  const roundTrip = await (await exportResponse()).json();
  assert.deepEqual(roundTrip.applications, withEvents.applications);
  const identical = await post("/api/applications/import", backup(withEvents.applications));
  assert.equal(identical.status, 201);
  assert.equal((await identical.json()).skipped, 1);
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
  await assertImportRejection(await post("/api/applications/import", backup([
    { ...record("invalid status"), status: "INVALID" },
    { ...record("invalid fields"), company: "", appliedDate: "invalid" },
  ])));
  await assertImportRejection(await post("/api/applications/import", backup([
    { ...record("invalid event"), events: [{ ...record("event").events[0], fromStatus: "INTERVIEW", toStatus: "OFFER" }] },
  ])));
  assert.equal(await prisma.application.count(), 1);
  const changedForUndo = await fetch(`${base}/api/applications/${seedId}`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: 0, archived: false }) });
  assert.equal(changedForUndo.status, 200);
  assert.equal((await changedForUndo.json()).application.revision, 1);
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), version: 2 }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, startupPage: undefined } }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, archivedExpanded: undefined } }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, motion: "reduced" } }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, timeFormat: undefined } }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, timeFormat: "36h" } }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, weekStart: undefined } }));
  await assertImportRejection(await post("/api/applications/import", { ...backup([]), settings: { ...settings, weekStart: "friday" } }));
  const boardColorsResponse = await post("/api/applications/import", { ...backup([]), settings: { ...settings, boards: [] } });
  assert.equal(boardColorsResponse.status, 400, "Board colors are no longer part of the backup settings");
  const initial = { id: randomUUID(), type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: "2026-09-24T01:00:00.000Z" };
  const complete = { ...record("complete history"), archived: false, events: [initial] };
  await assertImportRejection(await post("/api/applications/import", backup([{ ...complete, status: "OFFER" }])));
  await assertImportRejection(await post("/api/applications/import", backup([{ ...record("missing archived"), archived: undefined }])));
  await assertImportRejection(await post("/api/applications/import", backup([{ ...record("missing transition"), events: [{ ...record("event").events[0], fromStatus: undefined }] }])));
  assert.equal(await prisma.application.count(), 1, "Outdated backups must not create records");
  assert.equal((await post("/api/applications/import", { version: 1, applications: [], settings: { ...settings, startupPage: "interviews", staleApplicationThreshold: 30 } })).status, 201);
  assert.equal((await post("/api/applications/import", { ...backup([]), settings: { ...settings, startupPage: "table" } })).status, 201);
  assert.equal((await post("/api/applications/import", { ...backup([]), settings: { ...settings, startupPage: "analytics" } })).status, 400);
  assert.equal((await post("/api/applications/import", { ...backup([]), settings: { ...settings, motion: "on" } })).status, 201);
  assert.equal((await post("/api/applications/import", { ...backup([]), settings: { ...settings, motion: "off" } })).status, 201);
  assert.equal((await post("/api/applications/import", { version: 1, applications: [], settings: { ...settings, staleApplicationThreshold: 14 } })).status, 400);
  assert.equal((await post("/api/applications/import", { version: 1, applications: [], settings: { ...settings, staleApplicationThreshold: 21 } })).status, 400);
  assert.equal((await post("/api/applications/import", [])).status, 400);
  assert.equal((await post("/api/applications/import", backup([]))).status, 201);
  assert.equal((await post("/api/applications/import", backup([{ ...complete, id: randomUUID(), events: [{ ...initial, id: randomUUID(), toStatus: null, detail: null }] }]))).status, 201, "Incomplete legacy history remains importable");
  // A save from before board colors, the sidebar application list, and the default board were removed, and before the time format and week start settings existed.
  const olderSettings = { ...settings };
  delete olderSettings.timeFormat;
  delete olderSettings.weekStart;
  await prisma.settings.update({ where: { id: 1 }, data: { value: JSON.stringify({ ...olderSettings, theme: "dark", boards: [{ status: "APPLIED", color: "rose" }], allApplicationsExpanded: false, defaultBoard: "INTERVIEW" }) } });
  const legacySettings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(legacySettings.settings.theme, "dark", "Saved settings keep their values when they still carry board colors");
  assert.equal("boards" in legacySettings.settings, false);
  assert.equal("allApplicationsExpanded" in legacySettings.settings, false);
  assert.equal("defaultBoard" in legacySettings.settings, false);
  assert.equal(legacySettings.settings.timeFormat, "system", "Saves from before the time format setting follow the browser's clock");
  assert.equal(legacySettings.settings.weekStart, "system", "Saves from before the week start setting follow the browser's locale");
  const beforeSettings = await (await fetch(`${base}/api/settings`)).json();
  const changedSettingsResponse = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: beforeSettings.revision, changes: { theme: "dark", staleApplicationThreshold: 30 } }) });
  assert.equal(changedSettingsResponse.status, 200);
  const changedSettings = await changedSettingsResponse.json();
  assert.equal(changedSettings.settings.staleApplicationThreshold, 30);
  assert.equal(changedSettings.revision, beforeSettings.revision + 1);
  const staleSettings = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ revision: beforeSettings.revision, changes: { theme: "light" } }) });
  assert.equal(staleSettings.status, 409);
  assert.deepEqual(await staleSettings.json(), changedSettings);
  assert.deepEqual((await (await exportResponse()).json()).settings, changedSettings.settings);
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
  assert.deepEqual((await (await exportResponse()).json()).settings, changedSettings.settings);
  const deleted = await deleteApplication(seedId, true);
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
  const secondDelete = await deleteApplication(seedId, true);
  const secondToken = (await secondDelete.json()).token;
  await prisma.application.create({ data: { id: seedId, company: "Collision", role: "Collision", appliedDate: new Date() } });
  assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 409);
  await prisma.application.delete({ where: { id: seedId } });
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_expired_cleanup BEFORE DELETE ON UndoSnapshot WHEN OLD.token = '${secondToken}' BEGIN SELECT RAISE(ABORT, 'simulated cleanup failure'); END`);
  try {
    await prisma.undoSnapshot.update({ where: { token: secondToken }, data: { expiresAt: new Date(0) } });
    assert.equal(await prisma.undoSnapshot.count({ where: { token: secondToken } }), 1);
    assert.equal((await fetch(`${base}/api/applications`)).status, 200, "Loading applications must work with expired snapshots");
    assert.equal((await fetch(`${base}/dashboard`)).status, 200, "Rendering a page must work with expired snapshots");
    assert.equal((await post(`/api/applications/${seedId}/restore`, { token: secondToken })).status, 404, "Expired tokens remain invalid when cleanup fails");
    assert.equal(await prisma.undoSnapshot.count({ where: { token: secondToken } }), 1, "The failure fixture keeps the expired payload present");
    assert.equal(await prisma.application.count({ where: { id: seedId } }), 0);
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER reject_expired_cleanup");
  }

  // Bulk delete removes the whole selection in one transaction, and one restore brings all of it back.
  const bulkCreated = [];
  for (const name of ["bulk one", "bulk two", "bulk kept"]) {
    const response = await post("/api/applications", input(name));
    assert.equal(response.status, 201);
    bulkCreated.push((await response.json()).application);
  }
  const [bulkOne, bulkTwo, bulkKept] = bulkCreated;
  assert.equal((await post("/api/applications/bulk-delete", { applications: [] })).status, 400);
  assert.equal((await post("/api/applications/bulk-delete", { applications: [{ id: bulkOne.id, revision: 0 }, { id: bulkOne.id, revision: 0 }] })).status, 400, "Bulk delete IDs must be unique");
  const bulkDeleted = await post("/api/applications/bulk-delete", { applications: await bulkTargets([bulkOne.id, bulkTwo.id, "already-gone"]) });
  assert.equal(bulkDeleted.status, 200);
  const bulkDelete = await bulkDeleted.json();
  assert.deepEqual([...bulkDelete.deletedIds].sort(), [bulkOne.id, bulkTwo.id].sort(), "IDs already gone count as done and are not reported as deleted");
  assert.equal(await prisma.application.count({ where: { id: { in: [bulkOne.id, bulkTwo.id] } } }), 0);
  assert.equal(await prisma.application.count({ where: { id: bulkKept.id } }), 1, "Bulk delete leaves unselected applications alone");
  assert.equal((await post(`/api/applications/${bulkOne.id}/restore`, { token: bulkDelete.token })).status, 404, "A single restore cannot take one application out of a bulk delete");
  const bulkRestored = await post("/api/applications/bulk-restore", { token: bulkDelete.token, ids: bulkDelete.deletedIds });
  assert.equal(bulkRestored.status, 201);
  assert.deepEqual((await bulkRestored.json()).applications.map(({ id }) => id).sort(), [bulkOne.id, bulkTwo.id].sort());
  assert.equal((await prisma.applicationEvent.count({ where: { applicationId: bulkOne.id } })) > 0, true, "Bulk restore keeps status history");
  assert.equal((await post("/api/applications/bulk-restore", { token: bulkDelete.token, ids: bulkDelete.deletedIds })).status, 404, "A bulk restore can be used once");

  const expiringDelete = await (await post("/api/applications/bulk-delete", { applications: await bulkTargets([bulkOne.id, bulkTwo.id]) })).json();
  await prisma.undoSnapshot.updateMany({ where: { token: `${expiringDelete.token}:${bulkTwo.id}` }, data: { expiresAt: new Date(0) } });
  assert.equal((await post("/api/applications/bulk-restore", { token: expiringDelete.token, ids: expiringDelete.deletedIds })).status, 404, "An expired snapshot fails the whole restore");
  assert.equal(await prisma.application.count({ where: { id: { in: [bulkOne.id, bulkTwo.id] } } }), 0, "A failed bulk restore restores nothing");

  const collidingDelete = await (await post("/api/applications/bulk-delete", { applications: await bulkTargets([bulkKept.id]) })).json();
  await prisma.application.create({ data: { id: bulkKept.id, company: "Collision", role: "Collision", appliedDate: new Date() } });
  assert.equal((await post("/api/applications/bulk-restore", { token: collidingDelete.token, ids: collidingDelete.deletedIds })).status, 409);
  await prisma.application.delete({ where: { id: bulkKept.id } });

  const restoreCleanupCreated = await post("/api/applications", input("expired restore cleanup"));
  assert.equal(restoreCleanupCreated.status, 201);
  const restoreCleanupApplication = (await restoreCleanupCreated.json()).application;
  const restoreCleanupDelete = await deleteApplication(restoreCleanupApplication.id, true);
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
  assert.equal((await deleteApplication(deleteCleanupApplication.id)).status, 204);
  assert.equal(await prisma.undoSnapshot.count({ where: { token: deleteCleanupToken } }), 0, "Delete requests should purge expired snapshot payloads");

  const settingsBeforeCorruption = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  await prisma.settings.update({ where: { id: 1 }, data: { value: '{not json' } });
  const corruptExport = await exportResponse();
  assert.equal(corruptExport.status, 500, "Export must reject malformed stored settings");
  assert.match((await corruptExport.json()).error, /Could not export/);
  assert.equal((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value, '{not json', "Read must not rewrite the corrupt row");
  assert.equal((await fetch(`${base}/dashboard`)).status, 200, "Pages must survive malformed stored settings");
  const repair = await fetch(`${base}/api/settings`, { method: "PATCH", headers: mutationHeaders,
    body: JSON.stringify({ revision: settingsBeforeCorruption.revision, changes: { theme: "light" } }) });
  assert.equal(repair.status, 200, "PATCH must repair malformed stored settings");
  assert.equal((await repair.json()).settings.theme, "light");
  assert.equal(JSON.parse((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value).theme, "light");
  await prisma.settings.update({ where: { id: 1 }, data: { value: JSON.stringify({ theme: "neon" }) } });
  assert.equal((await exportResponse()).status, 500, "Export must reject schema-invalid stored settings");
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
  const skewedExport = await (await exportResponse()).json();
  assert.ok(skewedExport.applications.some(({ id }) => id === skewed.id));
  const purged = await fetch(`${base}/api/applications/purge`, { method: "DELETE", headers: mutationHeaders, body: "{}" });
  assert.equal(purged.status, 200);
  assert.equal(await prisma.application.count(), 0);
  const skewedReimport = await post("/api/applications/import", skewedExport);
  assert.equal(skewedReimport.status, 201, await skewedReimport.clone().text());
  assert.deepEqual((await (await exportResponse()).json()).applications, skewedExport.applications, "Export after a clock-skewed move must round-trip");

  // BAK-001: a history already stored out of order (created before the fix) must still be undo-restorable.
  const outOfOrder = await prisma.application.create({ data: {
    company: "Backup API test", role: "out of order history", status: "INTERVIEW", revision: 3, appliedDate: new Date("2026-09-24T00:00:00.000Z"),
    events: { create: [
      { type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: new Date("2026-09-24T02:00:00.000Z") },
      { type: "STATUS_CHANGE", fromStatus: "APPLIED", toStatus: "INTERVIEW", detail: "APPLIED → INTERVIEW", createdAt: new Date("2026-09-24T01:00:00.000Z") },
    ] },
  }, include: { events: true } });
  assert.equal((await exportResponse()).status, 500, "Export must reject an out-of-order history");
  const outOfOrderDelete = await deleteApplication(outOfOrder.id, true);
  assert.equal(outOfOrderDelete.status, 200);
  const outOfOrderRestore = await post(`/api/applications/${outOfOrder.id}/restore`, { token: (await outOfOrderDelete.json()).token });
  assert.equal(outOfOrderRestore.status, 201, await outOfOrderRestore.clone().text());
  const outOfOrderRestored = await prisma.application.findUniqueOrThrow({ where: { id: outOfOrder.id }, include: { events: true } });
  assert.equal(outOfOrderRestored.status, "INTERVIEW");
  assert.equal(outOfOrderRestored.revision, 3);
  const eventRow = ({ id, type, fromStatus, toStatus, detail, createdAt }) => [id, type, fromStatus, toStatus, detail, createdAt.toISOString()];
  assert.deepEqual(outOfOrderRestored.events.map(eventRow).sort(), outOfOrder.events.map(eventRow).sort(), "Undo restore must keep the stored history intact");

  await prisma.application.delete({ where: { id: outOfOrder.id } });

  // BAK-001: imported events dated after the import are rejected, not repaired.
  const beforeFutureImport = await prisma.application.count();
  const futureEvent = { ...initial, id: randomUUID(), createdAt: new Date(Date.now() + 86_400_000).toISOString() };
  await assertImportRejection(await post("/api/applications/import", backup([{ ...record("future event"), archived: false, events: [futureEvent] }])));
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
    await assertImportRejection(response, path);
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
  const storedPopulated = (await (await exportResponse()).json()).applications.find(({ id }) => id === fullyPopulated.id);
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

  // Reserved application IDs reject the entire import before applications, children, or settings change.
  const readImportState = async () => ({
    applications: await prisma.application.findMany({ orderBy: { id: "asc" } }),
    events: await prisma.applicationEvent.findMany({ orderBy: { id: "asc" } }),
    interviews: await prisma.interview.findMany({ orderBy: { id: "asc" } }),
    contacts: await prisma.contact.findMany({ orderBy: { id: "asc" } }),
    settings: await prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    snapshots: await prisma.undoSnapshot.findMany({ orderBy: { token: "asc" } }),
  });
  for (const id of ["bulk-delete", "bulk-restore"]) {
    const before = await readImportState();
    const persistedSettings = JSON.parse(before.settings.value);
    const changedSettings = { ...persistedSettings, theme: persistedSettings.theme === "dark" ? "light" : "dark" };
    const withChildren = () => ({ ...conforming(), interviews: [round({})], contacts: [person({})] });
    const ordinary = withChildren();
    const reserved = { ...withChildren(), id };
    await assertImportRejection(await post("/api/applications/import", {
      version: 1, applications: [ordinary, reserved], settings: changedSettings,
    }));
    assert.deepEqual(await readImportState(), before, `Rejected ${id} import must leave every application, child row, settings value, and revision unchanged`);
  }

  // Step 4: restore the exact attachment bytes into this empty isolated database.
  await prisma.application.update({ where: { id: fullyPopulated.id }, data: { archived: true } });
  const downloadedResponse = await exportResponse();
  assert.equal(downloadedResponse.status, 200, await downloadedResponse.clone().text());
  const downloadedBytes = Buffer.from(await downloadedResponse.arrayBuffer());
  const beforeRoundTrip = JSON.parse(downloadedBytes);
  const archivedPopulated = beforeRoundTrip.applications.find(({ id }) => id === fullyPopulated.id);
  assert.equal(archivedPopulated.archived, true);
  assert.equal(archivedPopulated.contacts.length, 1);
  assert.equal(archivedPopulated.interviews.length, 2);
  assert.ok(archivedPopulated.events.length >= 2);
  assert.equal((await fetch(`${base}/api/applications/purge`, { method: "DELETE", headers: mutationHeaders, body: "{}" })).status, 200);
  assert.equal(await prisma.application.count(), 0);
  assert.equal(await prisma.contact.count(), 0);
  const restoreUpload = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers: mutationHeaders, body: downloadedBytes });
  assert.equal(restoreUpload.status, 201, await restoreUpload.clone().text());
  const restoreToken = (await restoreUpload.json()).token;
  const restoredBytes = await fetch(`${base}/api/applications/import`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ token: restoreToken }) });
  assert.equal(restoredBytes.status, 201, await restoredBytes.clone().text());
  assert.equal((await restoredBytes.json()).created, beforeRoundTrip.applications.length);
  assert.deepEqual(Buffer.from(await (await exportResponse()).arrayBuffer()), downloadedBytes, "Exact downloaded bytes restore archives, settings and every child without normalization");

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
  const uploadSnapshot = async (records) => {
    const response = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers: mutationHeaders,
      body: JSON.stringify({ version: 1, settings: { ...settings, theme: "dark" }, applications: records }) });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).token;
  };
  const commitToken = (token) => fetch(`${base}/api/applications/import`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ token }) });
  const stagedNew = Array.from({ length: 450 }, (_, index) => ({ ...conforming(), id: `rollback-${index}` }));
  stagedNew[0].contacts = Array.from({ length: 1000 }, (_, index) => ({ ...person({}), id: `rollback-child-${index}` }));
  // Snapshots removed in early insertion pages must return on every later rollback.
  await prisma.undoSnapshot.createMany({ data: [randomUUID(), `${randomUUID()}:rollback-0`].map((token) => ({
    token, applicationId: "rollback-0", payload: JSON.stringify(stagedNew[0]), expiresAt: new Date(Date.now() + 600_000),
  })) });
  const saved = conforming();
  const seedToken = await uploadSnapshot([saved]);
  assert.equal((await commitToken(seedToken)).status, 201);
  const lateConflictToken = await uploadSnapshot([...stagedNew, saved]);
  // Introduce a change after review has begun, before commit acquires its transaction.
  assert.equal((await fetch(`${base}/api/applications/import/${lateConflictToken}?candidate=0`)).status, 200);
  await prisma.application.update({ where: { id: saved.id }, data: { role: "Changed during review" } });
  const beforeLateConflict = await readImportState();
  const lateConflict = await commitToken(lateConflictToken);
  assert.equal(lateConflict.status, 409, await lateConflict.clone().text());
  assert.deepEqual((await lateConflict.json()).conflicts, [saved.id]);
  assert.deepEqual(await readImportState(), beforeLateConflict, "Conflict after earlier batches must roll back all applications, children, settings, and revisions");
  const failureToken = await uploadSnapshot(stagedNew);
  const beforeFailure = await readImportState();
  const baselineRows = await prisma.application.count();
  await prisma.$executeRawUnsafe(`CREATE TRIGGER step3_insert_failure BEFORE INSERT ON Application WHEN NEW.id = 'rollback-420' BEGIN SELECT CASE WHEN (SELECT COUNT(*) FROM Application) >= ${baselineRows + 400} THEN RAISE(ABORT, 'injected late insertion failure') END; END`);
  try {
    const failure = await commitToken(failureToken);
    assert.equal(failure.status, 500, await failure.clone().text());
    assert.deepEqual(await readImportState(), beforeFailure, "SQLite failure after at least 400 inserts and 1000 children must roll back everything");
  } finally { await prisma.$executeRawUnsafe("DROP TRIGGER step3_insert_failure"); }

  // Exercise actual Prisma timeout and staging-reader failure after the first complete insertion page.
  const { registerHooks } = await import("node:module");
  await import("./unit-loader-register.mjs");
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  globalThis.prisma = prisma;
  const { commitStagedBackup } = await import("../src/lib/backup-commit.ts");
  const { serializeWrite } = await import("../src/lib/prisma.ts");
  const { setTimeout: wait } = await import("node:timers/promises");
  const directCounts = { applications: stagedNew.length, events: stagedNew.length, interviews: 0, contacts: 1000, settings };
  const reader = (onPage = async () => {}) => ({ counts: directCounts,
    applications: async (after) => {
      await onPage(after);
      return stagedNew.slice(after + 1, after + 201).map(({ events, interviews, contacts, ...fields }, index) => { void events; void interviews; void contacts; return { ...fields, position: after + 1 + index }; });
    },
    children: async (kind, owner, cursor) => stagedNew[owner][kind].filter((child) => child.id > cursor).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0).slice(0, 200),
  });
  const beforeDirect = await readImportState();
  const originalTransaction = prisma.$transaction.bind(prisma);
  let observedInserted = false;
  let activeTransaction;
  prisma.$transaction = (callback, options) => {
    assert.equal(options.timeout, 60000 + (450 + 450 + 1000) * 100, "Production timeout must derive from staged workload");
    return originalTransaction(async (transaction) => { activeTransaction = transaction; return callback(transaction); }, { ...options, timeout: 2000 });
  };
  try {
    await assert.rejects(commitStagedBackup(reader(async (after) => {
      if (after === 199) {
        assert.equal(await activeTransaction.application.count(), baselineRows + 200);
        assert.equal(await activeTransaction.contact.count({ where: { applicationId: "rollback-0" } }), 1000);
        assert.equal(await activeTransaction.undoSnapshot.count({ where: { applicationId: "rollback-0" } }), 0, "Snapshots must already be invalidated inside the transaction before timeout");
        observedInserted = true;
        await wait(2200);
      }
    })), /transaction|expired|closed/i);
    assert.equal(observedInserted, true, "Timeout must occur after a substantial complete insertion page");
  } finally { prisma.$transaction = originalTransaction; }
  assert.deepEqual(await readImportState(), beforeDirect, "Prisma timeout must roll back inserted applications and children");
  await assert.rejects(commitStagedBackup(reader(async (after) => {
    if (after === 199) throw new Error("injected staging reader failure");
  })), /injected staging reader failure/);
  assert.deepEqual(await readImportState(), beforeDirect, "Staging read failure after insertion must roll back everything");
  let releaseQueue;
  const waiting = serializeWrite(() => new Promise((resolve) => { releaseQueue = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  const cancelledCommit = commitStagedBackup(reader(), controller.signal);
  const cancellationCheck = assert.rejects(cancelledCommit, (error) => error.status === 409);
  controller.abort();
  releaseQueue();
  await waiting;
  await cancellationCheck;
  assert.deepEqual(await readImportState(), beforeDirect, "Cancellation before acquiring the write queue must not change data");

  const sameCompany = `Review ${randomUUID()}`;
  const liveMatch = { ...conforming(), company: sameCompany, role: "Software Engineer" };
  assert.equal((await commitToken(await uploadSnapshot([liveMatch]))).status, 201);
  const reviewRecords = [
    { ...conforming(), company: sameCompany, role: "Software Engineer II" },
    { ...conforming(), company: `Earlier ${sameCompany}`, role: "Developer" },
    { ...conforming(), company: `Ｅarlier ${sameCompany}`, role: "Developer" },
    { ...conforming(), id: liveMatch.id, company: sameCompany, role: "Software Engineer" },
  ];
  const reviewToken = await uploadSnapshot(reviewRecords);
  const reviewMatch = async (position) => {
    const response = await fetch(`${base}/api/applications/import/${reviewToken}?candidate=${position}`);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).match;
  };
  assert.equal((await reviewMatch(0)).kind, "close");
  assert.equal((await reviewMatch(0)).application.id, liveMatch.id);
  assert.equal(await reviewMatch(1), null);
  assert.equal((await reviewMatch(2)).kind, "exact");
  assert.equal((await reviewMatch(2)).application.id, reviewRecords[1].id);
  assert.equal(await reviewMatch(3), null, "Existing IDs skip duplicate prompting and are rechecked on commit");
  const beforeCancelReview = await readImportState();
  assert.equal((await fetch(`${base}/api/applications/import/${reviewToken}`, { method: "DELETE", headers: mutationHeaders })).status, 204);
  assert.deepEqual(await readImportState(), beforeCancelReview, "Cancel duplicate review must not change any live data");

  await verifySnapshotInvalidation();

  console.log("Passed: version 1 backup round trip, outdated backup rejection, identical merge, conflicts, malformed atomicity, settings-only import, one-time restore, expiry enforcement and mutation cleanup, corrupt settings recovery, collision, invalid status, chunked size limit, clock-skewed status events, out-of-order undo restore, future-dated import rejection, shared import field rules, legacy-row conflict detection.");
} finally { await prisma.$disconnect(); }
