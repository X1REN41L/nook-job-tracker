import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
const base = process.env.SMOKE_BASE_URL;
assert.ok(base);
const prisma = new PrismaClient();
const headers = { Origin: base, "Content-Type": "application/json" };
const ids = [];
const query = new URLSearchParams({ today: "2026-10-04", time: "00:00", timeZone: "UTC" });
async function get(path, status = 200) {
  const response = await fetch(base + path);
  assert.equal(response.status, status, path);
  assert.match(response.headers.get("cache-control") ?? "", /(?:^|[,\s])no-store(?:$|[,\s])/);
  return response;
}
try {
  const apps = Array.from({ length: 405 }, (_, i) => ({ id: randomUUID(), company: "Resource safeguard fixture", role: `Role ${i}`, status: "APPLIED", appliedDate: new Date("2026-01-01"), followUpDate: new Date("2026-02-01") }));
  ids.push(...apps.map((r) => r.id));
  await prisma.application.createMany({ data: apps });
  await prisma.applicationEvent.createMany({ data: apps.map((a) => ({ id: randomUUID(), applicationId: a.id, type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", createdAt: new Date("2026-01-01") })) });
  const owner = ids[0];
  await prisma.interview.createMany({ data: Array.from({ length: 405 }, (_, i) => ({ id: randomUUID(), applicationId: owner, date: new Date(i < 402 ? "2026-01-02" : "2026-10-05"), type: "PHONE" })) });
  await prisma.contact.createMany({ data: Array.from({ length: 405 }, () => ({ id: randomUUID(), applicationId: owner, name: "Fixture contact" })) });
  await prisma.applicationEvent.createMany({ data: Array.from({ length: 405 }, () => ({ id: randomUUID(), applicationId: owner, type: "NOTE_ADDED", detail: "Fixture note" })) });
  const seen = new Set();
  let after = "";
  for (;;) {
    const { applications } = await (await get(`/api/applications?after=${after}`)).json();
    assert.ok(applications.length <= 200);
    for (const row of applications) { assert.ok(!seen.has(row.id)); seen.add(row.id); assert.ok(row.interviews.length <= 200); assert.ok(row.contacts.length <= 200); }
    if (applications.length < 200) break;
    after = applications.at(-1).id;
  }
  assert.equal(seen.size, 405);
  for (const [collection, expected] of [["interviews", 405], ["contacts", 405], ["events", 406]]) {
    let count = 0;
    let cursor = "";
    for (;;) {
      const rows = (await (await get(`/api/applications?owner=${owner}&collection=${collection}&after=${cursor}`)).json())[collection];
      assert.ok(rows.length <= 200);
      count += rows.length;
      if (rows.length < 200) break;
      cursor = rows.at(-1).id;
    }
    assert.equal(count, expected);
  }
  const detail = await (await get(`/api/applications/${owner}`)).json();
  assert.equal(detail.application.interviews.length, 200);
  assert.equal(detail.application._count.interviews, 405);
  assert.equal(detail.application.contacts.length, 200);
  assert.equal(detail.events.length, 200);
  let followUps = 0;
  let stale = 0;
  for (const offset of [0, 200, 400]) {
    const overview = await (await get(`/api/dashboard/overview?${query}&offset=${offset}`)).json();
    assert.equal(overview.totalApplications, 405);
    assert.equal(overview.activePipeline, 405);
    assert.equal(overview.upcomingInterviews.count, 3);
    assert.equal(overview.interviewRate.historyCoverage.completeApplications, 405);
    assert.ok(overview.followUps.length <= 200);
    followUps += overview.followUps.length;
    const staleQuery = new URLSearchParams(query); staleQuery.delete("time");
    const data = await (await get(`/api/dashboard/stale?${staleQuery}&offset=${offset}`)).json();
    assert.equal(data.counts.total, 404);
    assert.ok(data.applicationsBySeverity.CRITICAL.length <= 200);
    stale += data.applicationsBySeverity.CRITICAL.length;
  }
  assert.equal(followUps, 405);
  assert.equal(stale, 404);
  for (const path of ["/", "/table", "/interviews", "/settings", "/api/settings"]) await get(path);
  await get("/api/applications/missing", 404);
  const oversized = await fetch(base + "/api/settings", { method: "PATCH", headers, body: " ".repeat(256 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.match(oversized.headers.get("cache-control"), /no-store/);
  const rejected = await fetch(base + "/api/applications/import/upload", { method: "POST", headers: { ...headers, Origin: "http://evil.example" }, body: "{}" });
  assert.equal(rejected.status, 403);
  assert.match(rejected.headers.get("cache-control"), /no-store/);
  // Dense mutations must keep response collections bounded while retaining every stored child.
  const updated = await fetch(base + `/api/applications/${owner}`, { method: "PATCH", headers, body: JSON.stringify({ revision: 0, archived: true }) });
  assert.equal(updated.status, 200);
  const saved = (await updated.json()).application;
  assert.equal(saved.interviews.length, 200);
  assert.equal(saved.contacts.length, 200);
  assert.equal(await prisma.interview.count({ where: { applicationId: owner } }), 405);
  // Undo internally keeps the complete recovery payload, independent of response pages.
  const deleted = await fetch(base + `/api/applications/${owner}?undoable=1`, { method: "DELETE", headers, body: JSON.stringify({ revision: saved.revision }) });
  assert.equal(deleted.status, 200);
  const { token } = await deleted.json();
  const restored = await fetch(base + `/api/applications/${owner}/restore`, { method: "POST", headers, body: JSON.stringify({ token }) });
  assert.equal(restored.status, 201);
  assert.equal(await prisma.interview.count({ where: { applicationId: owner } }), 405);
  assert.equal(await prisma.contact.count({ where: { applicationId: owner } }), 405);
  console.log("Resource safeguard API checks passed: 405 applications, dense child paging, aggregates, no-store, bounded mutations, complete Undo.");
} finally {
  await prisma.application.deleteMany({ where: { id: { in: ids } } });
  await prisma.undoSnapshot.deleteMany({ where: { applicationId: { in: ids } } });
  await prisma.$disconnect();
}
