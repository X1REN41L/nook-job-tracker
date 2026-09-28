import assert from "node:assert/strict";
import http from "node:http";
import { PrismaClient, Status } from "@prisma/client";

// Run only through `npm run test:smoke`, which starts an isolated test server on a temporary SQLite database.
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

// fetch cannot override Host, so DNS-rebinding requests are sent with node:http.
function hostRequest(host, path, method = "GET", body) {
  const { hostname, port } = new URL(base);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = {
    Host: host,
    ...(payload === undefined ? {} : { Origin: `http://${host}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }),
  };
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname, port, path, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

try {
  assert.deepEqual(Object.values(Status), ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"]);
  // `/` is a server redirect to the saved startup page, not a page of its own.
  const { settings } = await (await request("/api/settings")).json();
  const startupPath = { dashboard: "/dashboard", "job-board": "/jobs", interviews: "/interviews" }[settings.startupPage];
  assert.ok(startupPath, `Unknown startup page ${settings.startupPage}`);
  const root = await request("/");
  assert.equal(root.status, 307, "`/` must redirect to the startup page");
  assert.equal(new URL(root.headers.get("location"), base).pathname, startupPath);
  const page = await request(startupPath);
  assert.equal(page.status, 200, "The startup page must open without authentication");
  assert.doesNotMatch(await page.text(), /Signed in as|Sign in with Google/);
  // The [...slug] catch-all sends unknown page and API paths to the dashboard.
  for (const unknownPath of ["/no-such-page", "/api/no-such-route"]) {
    const unknown = await request(unknownPath);
    assert.equal(unknown.status, 307, `${unknownPath} must redirect`);
    assert.equal(new URL(unknown.headers.get("location"), base).pathname, "/dashboard");
  }
  assert.equal((await request("/dashboard")).status, 200);

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

  const { port } = new URL(base);
  const settingsBefore = await (await request("/api/settings")).json();
  for (const host of [`evil.test:${port}`, `localhost.evil.test:${port}`, `127.0.0.1.evil.test:${port}`, "evil.test"]) {
    const exportResponse = await hostRequest(host, "/api/applications/export");
    assert.equal(exportResponse.status, 403, `Export must reject Host ${host}`);
    assert.doesNotMatch(exportResponse.text, /Smoke test company/);
    const pageResponse = await hostRequest(host, "/dashboard");
    assert.equal(pageResponse.status, 403, `Pages must reject Host ${host}`);
    assert.doesNotMatch(pageResponse.text, /Smoke test company/);
    const settingsResponse = await hostRequest(host, "/api/settings", "PATCH", {
      revision: settingsBefore.revision, changes: { theme: settingsBefore.settings.theme === "dark" ? "light" : "dark" },
    });
    assert.equal(settingsResponse.status, 403, `Settings writes must reject Host ${host}`);
    assert.equal((await hostRequest(host, "/api/applications/purge", "DELETE", {})).status, 403, `Purge must reject Host ${host}`);
  }
  assert.equal(await prisma.application.count(), 1, "Rejected-Host requests must not delete records");
  assert.deepEqual(await (await request("/api/settings")).json(), settingsBefore, "Rejected-Host requests must not change settings");
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    const exportResponse = await hostRequest(host, "/api/applications/export");
    assert.equal(exportResponse.status, 200, `Export must allow Host ${host}`);
    assert.match(exportResponse.text, /Smoke test company/);
    assert.equal((await hostRequest(host, "/dashboard")).status, 200, `Pages must allow Host ${host}`);
  }

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
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 1, "Stale writes must not add status history beyond the initial event");

  const newerStatus = await request(path, "PATCH", { revision: application.revision, status: "INTERVIEW" });
  assert.equal(newerStatus.status, 200);
  application = (await newerStatus.json()).application;
  assert.equal(application.revision, staleClient.revision + 2);
  const staleArchive = await request(path, "PATCH", { revision: staleClient.revision + 1, archived: true });
  assert.equal(staleArchive.status, 409);
  const staleArchiveBody = await staleArchive.json();
  assert.equal(staleArchiveBody.application.status, "INTERVIEW");
  assert.equal(staleArchiveBody.application.archived, false);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 2, "A stale archive must preserve newer status history");

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
  // DATA-002: create and the status PATCH reject unknown keys instead of silently dropping them.
  for (const [method, target, body, field] of [
    ["POST", "/api/applications", { ...input, foo: 1 }, "foo"],
    ["POST", "/api/applications", { ...input, id: "chosen-id" }, "id"],
    ["PATCH", path, { revision: application.revision, status: "INTERVIEW", company: "Injected" }, "company"],
    ["PATCH", path, { revision: application.revision, status: "INTERVIEW", archived: true, foo: 1 }, "foo"],
  ]) {
    const response = await request(target, method, body);
    assert.equal(response.status, 400, `${method} with unknown key ${field} must be rejected`);
    const issues = (await response.json()).issues ?? [];
    assert.ok(issues.some((issue) => issue.path === field && issue.message === "Unrecognized field"), `${method} must name ${field}; received ${JSON.stringify(issues)}`);
  }
  assert.equal(await prisma.application.count(), 1, "Rejected unknown-key requests must not create records");
  const persisted = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { events: true } });
  assert.equal(persisted.role, "Edited internship");
  assert.equal(persisted.status, "APPLIED");
  assert.equal(persisted.events.length, 7);
  assert.ok(persisted.events.every(({ type }) => type === "STATUS_CHANGE"));
  assert.equal((await request(path, "PATCH", { revision: application.revision, status: "APPLIED" })).status, 200);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 7);
  assert.equal((await request(path, "DELETE")).status, 204);
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, "PATCH", { revision: application.revision, status: "ONLINE_ASSESSMENT" })).status, 404);
  assert.equal((await request(path, "DELETE")).status, 404);
  assert.equal(await prisma.applicationEvent.count({ where: { applicationId } }), 0);
  console.log("Passed: startup and unknown-route redirects, CRUD, all status moves, SQLite persistence, event history, validation, and cascade deletion.");
} finally {
  if (applicationId) await prisma.application.deleteMany({ where: { id: applicationId } });
  await prisma.$disconnect();
}
