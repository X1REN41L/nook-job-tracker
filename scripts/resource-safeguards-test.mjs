import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { Prisma } from "@prisma/client";
registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" ? "next/server.js" : specifier, context); } });
const { serializeWrite, WriteQueueFullError } = await import("../src/lib/write-queue.ts");
const { apiError, logOperationError } = await import("../src/lib/api.ts");
const { readBoundedJsonBody, checkMutationRequest } = await import("../src/lib/mutation-request.ts");
const { fetchApplicationSummaries, fetchApplicationDetail, readApplicationResponse, fetchStaleApplications, fetchDashboardOverview } = await import("../src/lib/application-pages.ts");

const limit = 256 * 1024;
const request = (body, extra = {}) => new Request("http://localhost:3000/api/applications", {
  method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", ...extra }, body,
  ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
});

test("ordinary body limit measures bytes, supports chunking, cancels overflow, and checks headers first", async () => {
  assert.equal((await readBoundedJsonBody(request(" ".repeat(limit)))).body.length, limit);
  for (const body of [" ".repeat(limit + 1), "é".repeat(limit / 2 + 1)]) {
    assert.equal((await checkMutationRequest(request(body))).response.status, 413);
  }
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(64 * 1024)); }, cancel() { cancelled = true; } });
  assert.equal((await readBoundedJsonBody(request(stream))).response.status, 413);
  assert.equal(cancelled, true);
  assert.equal((await readBoundedJsonBody(request("{}", { "content-length": String(limit + 1) }))).response.status, 413);
  assert.equal((await readBoundedJsonBody(request("{}", { "content-length": "-1" }))).response.status, 400);
  assert.equal((await checkMutationRequest(request("{}", { origin: "http://evil.example" }))).response.status, 403);
});

test("write queue allows 64 waiters, rejects without invoking write, survives failure and reload", async () => {
  let release;
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const active = serializeWrite(async () => { entered(); await new Promise((resolve) => { release = resolve; }); });
  await ready;
  const order = [];
  const waiting = Array.from({ length: 64 }, (_, i) => serializeWrite(async () => { order.push(i); if (i === 10) throw new Error("injected"); }));
  let called = false;
  const reloaded = await import("../src/lib/write-queue.ts?reload");
  const error = await reloaded.serializeWrite(async () => { called = true; }).catch((error) => error);
  assert.ok(error instanceof reloaded.WriteQueueFullError);
  const response = apiError(new WriteQueueFullError(), "test.write");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "1");
  assert.equal(called, false);
  release();
  await active;
  const results = await Promise.allSettled(waiting);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.deepEqual(order, Array.from({ length: 64 }, (_, i) => i));
  assert.equal(await serializeWrite(async () => "recovered"), "recovered");
  assert.equal(globalThis.prismaPendingWrites, 0);
});

test("database logging emits only fixed operation names and allowlisted codes", (t) => {
  const messages = [];
  t.mock.method(console, "error", (...args) => messages.push(args));
  logOperationError("test.database", new Prisma.PrismaClientKnownRequestError("SECRET /private/path SELECT payload", { code: "P2002", clientVersion: "test" }));
  logOperationError("test.database", new Error("SECRET"));
  logOperationError("test.database", new Prisma.PrismaClientKnownRequestError("SECRET", { code: "SECRET", clientVersion: "test" }));
  assert.deepEqual(messages, [["test.database", "P2002"], ["test.database", "UNEXPECTED"], ["test.database", "UNEXPECTED"]]);
});

const rows = (n, kind) => Array.from({ length: n }, (_, i) => ({ id: `${kind}-${String(i).padStart(4, "0")}`, createdAt: "2026-01-01T00:00:00.000Z", date: "2026-01-01", time: null }));
test("client traverses application, child, conflict, restore, follow-up, and stale pages completely", async (t) => {
  const applications = rows(405, "application").map((row) => ({ ...row, interviews: [], contacts: [], interviewCount: row.id.endsWith("0000") ? 405 : 0, _count: { interviews: row.id.endsWith("0000") ? 405 : 0, contacts: 405 } }));
  const children = { interviews: rows(405, "interview"), contacts: rows(405, "contact"), events: rows(405, "event") };
  const stale = rows(405, "stale");
  t.mock.method(globalThis, "fetch", async (url) => {
    const parsed = new URL(url, "http://localhost:3000");
    const q = parsed.searchParams;
    const page = (list) => list.filter((r) => r.id > (q.get("after") ?? "")).slice(0, 200);
    if (q.has("owner")) return Response.json({ [q.get("collection")]: page(children[q.get("collection")]) });
    if (parsed.pathname === "/api/applications") return Response.json({ applications: page(applications) });
    if (parsed.pathname.startsWith("/api/applications/")) return Response.json({ application: applications[0], events: [] });
    const offset = Number(q.get("offset"));
    if (parsed.pathname.endsWith("overview")) return Response.json({ followUps: stale.slice(offset, offset + 200) });
    return Response.json({ applicationsBySeverity: { CRITICAL: stale.slice(offset, offset + 200), HIGH: [], MEDIUM: [] }, archived: stale.slice(offset, offset + 200) });
  });
  const summaries = await fetchApplicationSummaries();
  assert.equal(summaries.length, 405);
  assert.equal(summaries[0].interviews.length, 405);
  const detail = await fetchApplicationDetail(applications[0].id);
  assert.equal(detail.application.contacts.length, 405);
  assert.equal(detail.events.length, 405);
  for (const key of ["conflictIds", "restoredIds"]) {
    const body = await readApplicationResponse(Response.json({ applications: applications.slice(0, 200), [key]: applications.map((r) => r.id) }));
    assert.equal(body.applications.length, 405);
  }
  assert.equal((await fetchDashboardOverview(new URLSearchParams())).followUps.length, 405);
  assert.equal((await fetchStaleApplications(new URLSearchParams())).applicationsBySeverity.CRITICAL.length, 405);
});
