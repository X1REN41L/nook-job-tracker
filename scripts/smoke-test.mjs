import assert from "node:assert/strict";
import { PrismaClient, Status } from "@prisma/client";

// Run against a running local app; only this script's own record is removed.
const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const prisma = new PrismaClient();
let applicationId;

async function request(path, method = "GET", body) {
  return fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
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

  assert.equal((await request("/api/applications", "POST", {})).status, 400);
  const malformed = await fetch(`${base}/api/applications`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(malformed.status, 400);
  const input = {
    company: "Smoke test company", role: "Test internship", status: "APPLIED",
    appliedDate: "2026-09-21", source: "Smoke test", notes: "Temporary verification record",
    jobUrl: "https://example.com/job",
  };
  const created = await request("/api/applications", "POST", input);
  assert.equal(created.status, 201);
  const application = (await created.json()).application;
  applicationId = application.id;
  assert.equal(application.company, input.company);
  assert.equal("userId" in application, false);
  const path = `/api/applications/${applicationId}`;
  assert.equal((await request(path)).status, 200);
  const list = await (await request("/api/applications")).json();
  assert.ok(list.applications.some(({ id }) => id === applicationId));

  const edited = await request(path, "PUT", { ...input, role: "Edited internship" });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).application.role, "Edited internship");
  for (const status of ["ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "APPLIED"]) {
    const moved = await request(path, "PATCH", { status });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).application.status, status);
    const archived = await request(path, "PATCH", { archived: true });
    assert.equal(archived.status, 200);
    const archivedRecord = (await archived.json()).application;
    assert.equal(archivedRecord.status, status);
    assert.equal(archivedRecord.archived, true);
    const restored = await request(path, "PATCH", { archived: false });
    assert.equal(restored.status, 200);
    const restoredRecord = (await restored.json()).application;
    assert.equal(restoredRecord.status, status);
    assert.equal(restoredRecord.archived, false);
  }
  assert.equal((await request(path, "PATCH", { status: "INVALID" })).status, 400);
  assert.equal((await request(path, "PATCH", { status: "INVALID", archived: true })).status, 400);
  assert.equal((await request(path, "PUT", { ...input, appliedDate: "2026-02-30" })).status, 400);
  assert.equal((await request(path, "PUT", { ...input, jobUrl: "javascript:alert(1)" })).status, 400);
  const persisted = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { events: true } });
  assert.equal(persisted.role, "Edited internship");
  assert.equal(persisted.status, "APPLIED");
  assert.equal(persisted.events.length, 5);
  assert.ok(persisted.events.every(({ type }) => type === "STATUS_CHANGE"));
  assert.equal((await request(path, "PATCH", { status: "APPLIED" })).status, 200);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 5);
  assert.equal((await request(path, "DELETE")).status, 204);
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, "PATCH", { status: "ONLINE_ASSESSMENT" })).status, 404);
  assert.equal((await request(path, "DELETE")).status, 404);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 0);
  console.log("Passed: no-login routing, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion.");
} finally {
  if (applicationId) await prisma.application.deleteMany({ where: { id: applicationId } });
  await prisma.$disconnect();
}
