import assert from "node:assert/strict";
import { PrismaClient, Status } from "@prisma/client";

// Run against a running local app; only this script's own record is removed.
const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const origin = new URL(base).origin;
const prisma = new PrismaClient();
let applicationId;

async function request(path, method = "GET", body) {
  const mutating = !["GET", "HEAD"].includes(method);
  return fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(mutating ? { Origin: origin, "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

try {
  assert.deepEqual(Object.values(Status), ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"]);
  const page = await request("/");
  assert.equal(page.status, 200, "Dashboard must open without authentication");
  assert.doesNotMatch(await page.text(), /Signed in as|Sign in with Google/);
  assert.equal((await request("/login")).status, 404);
  assert.equal((await request("/api/auth/session")).status, 404);
  assert.equal((await request("/dashboard")).status, 404);

  const rejectedInput = {
    company: "Blocked request", role: "Must not be saved", status: "APPLIED", appliedDate: "2026-09-21",
  };
  const rejectedOrigin = await fetch(`${base}/api/applications`, {
    method: "POST",
    headers: { Origin: "http://attacker.invalid", "Content-Type": "application/json" },
    body: JSON.stringify(rejectedInput),
  });
  assert.equal(rejectedOrigin.status, 403);
  assert.match((await rejectedOrigin.json()).error, /origin/i);
  assert.equal((await fetch(`${base}/api/applications`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rejectedInput),
  })).status, 403);
  assert.equal((await fetch(`${base}/api/applications`, {
    method: "POST", headers: { Origin: "null", "Content-Type": "application/json" }, body: JSON.stringify(rejectedInput),
  })).status, 403);
  assert.equal(await prisma.application.count(), 0, "Rejected-origin requests must not create records");

  const wrongContentType = await fetch(`${base}/api/applications`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify(rejectedInput),
  });
  assert.equal(wrongContentType.status, 415);
  assert.match((await wrongContentType.json()).error, /application\/json/);
  const oversized = await fetch(`${base}/api/applications`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "x".repeat(10 * 1024 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /10 MB/);
  assert.equal(await prisma.application.count(), 0, "Rejected request bodies must not create records");

  assert.equal((await request("/api/applications", "POST", {})).status, 400);
  const malformed = await fetch(`${base}/api/applications`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json; charset=utf-8" }, body: "{",
  });
  assert.equal(malformed.status, 400);
  const input = {
    company: "Smoke test company", role: "Test internship", status: "APPLIED",
    appliedDate: "2026-09-21", source: "Smoke test", notes: "Temporary verification record",
    jobUrl: "https://example.com/job",
  };
  const created = await request("/api/applications", "POST", input);
  assert.equal(created.status, 201);
  let application = (await created.json()).application;
  applicationId = application.id;
  assert.equal(application.company, input.company);
  assert.equal("userId" in application, false);
  const path = `/api/applications/${applicationId}`;
  assert.equal((await request(path)).status, 200);
  const list = await (await request("/api/applications")).json();
  assert.ok(list.applications.some(({ id }) => id === applicationId));

  const staleClient = { ...application };
  const edited = await request(path, "PUT", { ...input, role: "Edited internship", revision: application.revision });
  assert.equal(edited.status, 200);
  application = (await edited.json()).application;
  assert.equal(application.role, "Edited internship");
  assert.equal(application.revision, staleClient.revision + 1);

  const staleEdit = await request(path, "PUT", { ...input, role: "Stale client overwrite", revision: staleClient.revision });
  assert.equal(staleEdit.status, 409);
  const staleEditBody = await staleEdit.json();
  assert.equal(staleEditBody.application.role, "Edited internship");
  assert.equal(staleEditBody.application.revision, application.revision);

  const staleStatus = await request(path, "PATCH", { revision: staleClient.revision, status: "INTERVIEW" });
  assert.equal(staleStatus.status, 409);
  const staleStatusBody = await staleStatus.json();
  assert.equal(staleStatusBody.application.revision, application.revision);
  assert.equal(staleStatusBody.application.status, "APPLIED");
  assert.equal(staleStatusBody.application.role, "Edited internship");
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 0, "Stale writes must not add status history");

  const newerStatus = await request(path, "PATCH", { revision: application.revision, status: "INTERVIEW" });
  assert.equal(newerStatus.status, 200);
  application = (await newerStatus.json()).application;
  assert.equal(application.revision, staleClient.revision + 2);
  const staleArchive = await request(path, "PATCH", { revision: staleClient.revision + 1, archived: true });
  assert.equal(staleArchive.status, 409);
  const staleArchiveBody = await staleArchive.json();
  assert.equal(staleArchiveBody.application.status, "INTERVIEW");
  assert.equal(staleArchiveBody.application.archived, false);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 1, "A stale archive must preserve newer status history");

  for (const status of ["ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "APPLIED"]) {
    const moved = await request(path, "PATCH", { revision: application.revision, status });
    assert.equal(moved.status, 200);
    application = (await moved.json()).application;
    assert.equal(application.status, status);
    const archived = await request(path, "PATCH", { revision: application.revision, archived: true });
    assert.equal(archived.status, 200);
    application = (await archived.json()).application;
    const archivedRecord = application;
    assert.equal(archivedRecord.status, status);
    assert.equal(archivedRecord.archived, true);
    const restored = await request(path, "PATCH", { revision: application.revision, archived: false });
    assert.equal(restored.status, 200);
    application = (await restored.json()).application;
    const restoredRecord = application;
    assert.equal(restoredRecord.status, status);
    assert.equal(restoredRecord.archived, false);
  }
  assert.equal((await request(path, "PATCH", { revision: application.revision, status: "INVALID" })).status, 400);
  assert.equal((await request(path, "PATCH", { revision: application.revision, status: "INVALID", archived: true })).status, 400);
  assert.equal((await request(path, "PUT", { ...input, revision: application.revision, appliedDate: "2026-02-30" })).status, 400);
  assert.equal((await request(path, "PUT", { ...input, revision: application.revision, jobUrl: "javascript:alert(1)" })).status, 400);
  const persisted = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { events: true } });
  assert.equal(persisted.role, "Edited internship");
  assert.equal(persisted.status, "APPLIED");
  assert.equal(persisted.events.length, 6);
  assert.ok(persisted.events.every(({ type }) => type === "STATUS_CHANGE"));
  assert.equal((await request(path, "PATCH", { revision: application.revision, status: "APPLIED" })).status, 200);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 6);
  assert.equal((await request(path, "DELETE")).status, 204);
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, "PATCH", { revision: application.revision, status: "ONLINE_ASSESSMENT" })).status, 404);
  assert.equal((await request(path, "DELETE")).status, 404);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 0);
  console.log("Passed: no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion.");
} finally {
  if (applicationId) await prisma.application.deleteMany({ where: { id: applicationId } });
  await prisma.$disconnect();
}
