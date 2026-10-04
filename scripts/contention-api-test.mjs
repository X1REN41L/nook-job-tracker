import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const prisma = new PrismaClient();
assert.match(process.env.DATABASE_URL ?? "", /^file:/, "DATABASE_URL must name the isolated SQLite file");
const databasePath = process.env.DATABASE_URL.slice("file:".length);
const headers = { Origin: new URL(base).origin, "Content-Type": "application/json" };
async function deleteApplication(id, undoable = false) {
  const current = await fetch(`${base}/api/applications/${id}`);
  assert.equal(current.status, 200);
  const { application } = await current.json();
  return fetch(`${base}/api/applications/${id}${undoable ? "?undoable=1" : ""}`, {
    method: "DELETE", headers, body: JSON.stringify({ revision: application.revision }),
  });
}
const settings = { theme: "system", startupPage: "dashboard", staleApplicationThreshold: 15,
  motion: "system", timeFormat: "system", weekStart: "system", sidebarCollapsed: false, archivedExpanded: false };
const date = "2026-09-24T00:00:00.000Z";
const records = Array.from({ length: 2_000 }, (_, index) => ({
  id: randomUUID(), company: "Contention test", role: `Role ${index}`, status: "APPLIED", source: null,
  appliedDate: date, followUpDate: null, followUpNote: null, interviews: [], contacts: [], interviewDatePromptDismissed: false, archived: false, notes: null, jobUrl: null,
  createdAt: date, lastUpdated: date,
  events: [{ id: randomUUID(), type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED",
    detail: "null → APPLIED", createdAt: date }],
}));

async function withDeadline(pending, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** True while another connection holds SQLite's write lock. This connection never waits for the lock. */
function writeLockHeldElsewhere() {
  const connection = new DatabaseSync(databasePath, { timeout: 0 });
  try {
    connection.exec("BEGIN IMMEDIATE");
    connection.exec("ROLLBACK");
    return false;
  } catch (error) {
    if (/database is locked/i.test(error.message)) return true;
    throw error;
  } finally {
    connection.close();
  }
}

async function withHeldWriteLock(probe, acquireMs = 10_000) {
  const before = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const lockAcquired = Promise.withResolvers();
  const release = Promise.withResolvers();
  let releaseSignaled = false;
  let transactionSettled = false;
  const heldWrite = prisma.$transaction(async (tx) => {
    // Updating the existing value acquires a write lock without changing the fixture.
    await tx.settings.update({ where: { id: 1 }, data: { value: before.value } });
    lockAcquired.resolve();
    await release.promise;
  }, { maxWait: 5_000, timeout: 30_000 });
  heldWrite.then(() => { transactionSettled = true; }, (error) => {
    transactionSettled = true;
    lockAcquired.reject(error);
  });
  const assertLockHeld = () => {
    assert.equal(releaseSignaled, false, "Release must not be signaled before the probe completes");
    assert.equal(transactionSettled, false, "The write transaction must remain active through the probe");
  };
  let failure;
  try {
    await withDeadline(lockAcquired.promise, acquireMs, "Timed out acquiring the SQLite write lock");
    assertLockHeld();
    return await probe(assertLockHeld);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    releaseSignaled = true;
    release.resolve();
    // The first failure is the one reported; a transaction that outlived an acquisition timeout fails or commits later.
    const transactionError = await heldWrite.then(() => undefined, (error) => error);
    if (transactionError && !failure) throw transactionError;
    assert.deepEqual(await prisma.settings.findUniqueOrThrow({ where: { id: 1 } }), before,
      "The lock fixture must preserve the complete settings row");
  }
}

try {
  const warmPage = await fetch(`${base}/dashboard`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(warmPage.status, 200, "Warm page route before acquiring the read-probe lock");
  await warmPage.arrayBuffer();
  const staged = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers,
    body: JSON.stringify({ version: 1, applications: records, settings }) });
  assert.equal(staged.status, 201, await staged.clone().text());
  const stagedToken = (await staged.json()).token;
  const started = Date.now();
  let importSettled = false;
  const importing = fetch(`${base}/api/applications/import`, { method: "POST", headers,
    signal: AbortSignal.timeout(60_000), body: JSON.stringify({ token: stagedToken }) })
    .finally(() => { importSettled = true; });
  // Reads sent while the import's transaction holds the write lock must answer from the committed data before it.
  await withDeadline((async () => {
    while (!writeLockHeldElsewhere()) {
      if (importSettled) throw new Error("The import finished before its write transaction was observed");
      await delay(2);
    }
  })(), 30_000, "Timed out waiting for the import transaction to take the write lock");
  const [overlapList, overlapPage] = await Promise.all([
    fetch(`${base}/api/applications`, { signal: AbortSignal.timeout(20_000) }),
    fetch(`${base}/dashboard`, { signal: AbortSignal.timeout(20_000) }),
  ]);
  assert.equal(overlapList.status, 200, `List GET during the import transaction: ${overlapList.status}`);
  assert.equal(overlapPage.status, 200, `Page GET during the import transaction: ${overlapPage.status}`);
  const overlapCount = (await overlapList.json()).applications.length;
  await overlapPage.arrayBuffer();
  assert.equal(importSettled, false, "The import response must still be pending when the reads finish");
  assert.equal(writeLockHeldElsewhere(), true, "The import transaction must still hold the write lock when the reads finish");
  assert.equal(overlapCount, 0, "Reads during the import transaction must not see its uncommitted records");
  const imported = await importing;
  assert.equal(imported.status, 201, `Import status ${imported.status}: ${(await imported.clone().text()).slice(0, 600)}`);
  const result = await imported.json();
  assert.equal(result.created, records.length);
  assert.equal(await prisma.application.count(), records.length);
  const importMs = Date.now() - started;

  const [list, page] = await withHeldWriteLock(async (assertLockHeld) => {
    const responses = await Promise.all([
      fetch(`${base}/api/applications`, { signal: AbortSignal.timeout(20_000) }),
      fetch(`${base}/dashboard`, { signal: AbortSignal.timeout(20_000) }),
    ]);
    assert.equal(responses[0].status, 200, `List GET under an external write lock: ${responses[0].status}`);
    assert.equal(responses[1].status, 200, `Page GET under an external write lock: ${responses[1].status}`);
    await Promise.all(responses.map((response) => response.arrayBuffer()));
    assertLockHeld();
    return responses;
  });

  // A second lock attempt queued behind a held one gives up at its deadline, reports that timeout rather than its
  // transaction's later failure, never runs its probe, and leaves the first lock held.
  const deadline = await withHeldWriteLock(async (assertLockHeld) => {
    const attempted = Date.now();
    await assert.rejects(
      withHeldWriteLock(() => assert.fail("The probe must not run without the write lock"), 500),
      /Timed out acquiring the SQLite write lock/,
    );
    assertLockHeld();
    return { acquisitionDeadlineMs: 500, settledAfterMs: Date.now() - attempted };
  });

  const id = records[0].id;
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/api/applications/${id}`, {
    method: "PATCH", headers, body: JSON.stringify({ revision: 0, status: "INTERVIEW" }),
  })));
  const statuses = responses.map((response) => response.status);
  assert.ok(statuses.every((status) => status === 200 || status === 409), `Unexpected PATCH statuses: ${statuses.join(", ")}`);
  assert.equal(statuses.filter((status) => status === 200).length, 1);
  assert.equal(statuses.filter((status) => status === 409).length, 4);
  const final = await prisma.application.findUniqueOrThrow({ where: { id }, include: { events: true } });
  assert.equal(final.revision, 1);
  assert.equal(final.events.length, 2);

  const settingsRow = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  await prisma.settings.update({ where: { id: 1 }, data: { value: '{not json' } });
  const exportResponse = await fetch(`${base}/api/applications/export`, { method: "POST", headers });
  assert.equal(exportResponse.status, 500, "Export must reject corrupt persisted settings");
  assert.match((await exportResponse.json()).error, /Could not export/);
  assert.equal((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value, '{not json', "Export must not repair settings on read");
  const repair = await fetch(`${base}/api/settings`, { method: "PATCH", headers,
    body: JSON.stringify({ revision: settingsRow.revision, changes: { theme: "dark" } }) });
  assert.equal(repair.status, 200, "Settings PATCH must repair corrupt persisted settings");
  assert.equal(JSON.parse((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).value).theme, "dark");

  const deleted = await deleteApplication(id, true);
  assert.equal(deleted.status, 200);
  const { token } = await deleted.json();
  await prisma.undoSnapshot.update({ where: { token }, data: { expiresAt: new Date(0) } });
  assert.equal((await fetch(`${base}/api/applications`)).status, 200);
  assert.equal((await fetch(`${base}/dashboard`)).status, 200);
  // Scheduled maintenance may already have removed the row (tested directly by the maintenance suite); either way the
  // expired token must not restore.
  const expiredRestore = await fetch(`${base}/api/applications/${id}/restore`, { method: "POST", headers,
    body: JSON.stringify({ token }) });
  assert.equal(expiredRestore.status, 404, "Expired snapshots must not be restorable");

  const lockedPatch = await withHeldWriteLock(async (assertLockHeld) => {
    const response = await fetch(`${base}/api/settings`, { method: "PATCH", headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ revision: settingsRow.revision + 1, changes: { theme: "light" } }) });
    await response.text();
    assertLockHeld();
    assert.equal(response.status, 503, "A temporary SQLite write lock must return 503");
    assert.equal(response.headers.get("retry-after"), "1");
    return response;
  });

  const send = async (path, method, body) => {
    if (path === "/api/applications/import") {
      const uploaded = await fetch(`${base}${path}/upload`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!uploaded.ok) return uploaded;
      body = { token: (await uploaded.json()).token };
    }
    return fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) });
  };
  const [undoTarget, restoreTarget, putTarget, ...patchTargets] = records.slice(1, 8).map((record) => record.id);
  const moved = await send(`/api/applications/${undoTarget}`, "PATCH", { revision: 0, status: "INTERVIEW" });
  assert.equal(moved.status, 200);
  const { latestStatusEventId } = await moved.json();
  const restorable = await deleteApplication(restoreTarget, true);
  assert.equal(restorable.status, 200);
  const { token: restoreToken } = await restorable.json();
  const putRecord = await prisma.application.findUniqueOrThrow({ where: { id: putTarget } });
  const settingsRevision = (await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).revision;
  const newApplication = (index) => ({ company: "Mixed write", role: `New ${index}`, status: "APPLIED", appliedDate: "2026-09-24" });
  const mixedWrites = [
    ["undo-status", send(`/api/applications/${undoTarget}/undo-status`, "POST", { revision: 1, expectedLatestStatusEventId: latestStatusEventId,
      archived: false, interviewDatePromptDismissed: false }), 200],
    ["restore", send(`/api/applications/${restoreTarget}/restore`, "POST", { token: restoreToken }), 201],
    ["put", send(`/api/applications/${putTarget}`, "PUT", { revision: 0, company: putRecord.company, role: "Edited",
      source: "", appliedDate: "2026-09-24", notes: "", jobUrl: "" }), 200],
    ...patchTargets.map((target) => ["patch", send(`/api/applications/${target}`, "PATCH", { revision: 0, status: "REJECTED" }), 200]),
    ["settings", send("/api/settings", "PATCH", { revision: settingsRevision, changes: { theme: "dark" } }), 200],
    ["delete", deleteApplication(records[8].id, true), 200],
    ["plain-delete", deleteApplication(records[9].id), 204],
    ...[0, 1, 2].map((index) => ["create", send("/api/applications", "POST", newApplication(index)), 201]),
    ["import", send("/api/applications/import", "POST", { version: 1, settings, applications: records.slice(10, 12).map((record) => ({
      ...record, id: randomUUID(), events: record.events.map((event) => ({ ...event, id: randomUUID() })) })) }), 201],
  ];
  const mixedResults = await Promise.all(mixedWrites.map(async ([route, pending, expected]) => {
    const response = await pending;
    return { route, expected, status: response.status, body: (await response.text()).slice(0, 300) };
  }));
  for (const { route, expected, status, body } of mixedResults) {
    assert.equal(status, expected, `Concurrent ${route} write returned ${status}: ${body}`);
  }
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: undoTarget } })).status, "APPLIED");
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId: undoTarget } }), 1);
  assert.ok(await prisma.application.findUnique({ where: { id: restoreTarget } }), "Restore must recreate the application");
  assert.equal((await prisma.application.findUniqueOrThrow({ where: { id: putTarget } })).role, "Edited");
  for (const target of patchTargets) {
    const patched = await prisma.application.findUniqueOrThrow({ where: { id: target }, include: { events: true } });
    assert.equal(patched.status, "REJECTED");
    assert.equal(patched.events.length, 2);
  }
  assert.equal(await prisma.application.count({ where: { id: { in: [records[8].id, records[9].id] } } }), 0);
  assert.equal(await prisma.application.count({ where: { company: "Mixed write" } }), 3);

  console.log(JSON.stringify({ importRecords: records.length, importMs, importOverlap: { listStatus: overlapList.status, pageStatus: overlapPage.status, applicationsSeen: overlapCount },
    acquisitionDeadline: deadline, readProbe: "external-write-lock", listStatus: list.status,
    pageStatus: page.status, patchStatuses: statuses, exportStatus: exportResponse.status,
    repairStatus: repair.status, expiredRestoreStatus: expiredRestore.status, lockedPatchStatus: lockedPatch.status,
    mixedWriteStatuses: mixedResults.map(({ route, status }) => `${route}:${status}`) }));
} finally {
  await prisma.$disconnect();
}
