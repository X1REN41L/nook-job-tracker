import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
const base = process.env.SMOKE_BASE_URL;
assert.ok(base);
const origin = new URL(base).origin;
const headers = { Origin: origin, "Content-Type": "application/json" };
const prisma = new PrismaClient();
async function rawStatus(path, method, changes, body = "") {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: url.hostname, port: url.port, path, method, headers: { ...headers, ...changes } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

const settings = { theme: "system", startupPage: "dashboard", staleApplicationThreshold: 15, motion: "system", timeFormat: "system", weekStart: "system", sidebarCollapsed: false, archivedExpanded: false };
const date = "2026-09-01T00:00:00.000Z";
const application = (id) => ({ id, company: "Large upload", role: "Engineer", status: "APPLIED", archived: false,
  source: null, appliedDate: date, followUpDate: null, followUpNote: null, interviews: [], contacts: [], interviewDatePromptDismissed: false,
  notes: null, jobUrl: null, createdAt: date, lastUpdated: date, events: [] });
const snapshot = JSON.stringify({ version: 1, settings, applications: [] });
let bytes = 0;
async function* chunks(malformed) {
  yield `{"version":1,"settings":${JSON.stringify(settings)},"applications":[`;
  for (let index = 0; index < 5001; index++) yield `${index ? "," : ""}${JSON.stringify(application(`api-large-${index}`))}`;
  const dense = application("api-dense"); delete dense.contacts;
  yield `,${JSON.stringify(dense).slice(0, -1)},"contacts":[`;
  for (let index = 0; index < 40000; index++) yield `${index ? "," : ""}${JSON.stringify({ id: `api-contact-${index}`, name: "日本語 😀", role: null, email: null, linkedinUrl: null, notes: "x".repeat(200), createdAt: date })}`;
  yield malformed ? "]}]} trailing" : "]}]}";
}
function streamed(malformed) {
  const iterator = chunks(malformed);
  return new ReadableStream({ async pull(controller) {
    const next = await iterator.next();
    if (next.done) controller.close(); else { const value = new TextEncoder().encode(next.value); bytes += value.byteLength; controller.enqueue(value); }
  }, async cancel() { await iterator.return(); } });
}
async function cancel(token) {
  const result = await fetch(`${base}/api/applications/import/${token}`, { method: "DELETE", headers });
  assert.equal(result.status, 204, await result.clone().text());
}
const unchanged = async (baseline) => {
  assert.equal(await prisma.application.count(), baseline.count);
  assert.deepEqual(await prisma.settings.findUnique({ where: { id: 1 } }), baseline.settings);
};
try {
  const baseline = { count: await prisma.application.count(), settings: await prisma.settings.findUnique({ where: { id: 1 } }) };
  for (const [changes, expected] of [
    [{ Host: "attacker.invalid", Origin: "http://attacker.invalid" }, 403],
    [{ Origin: "http://attacker.invalid" }, 403],
    [{ Origin: "null" }, 403],
    [{ Origin: "" }, 403],
    [{ "Content-Type": "text/plain" }, 415],
  ]) {
    const result = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers: { ...headers, ...changes }, body: snapshot });
    assert.equal(result.status, expected, await result.clone().text());
  }
  for (const [changes, expected] of [
    [{ Host: "attacker.invalid", Origin: "http://attacker.invalid" }, 403],
    [{ Origin: "http://attacker.invalid" }, 403], [{ Origin: "null" }, 403],
    [{ Origin: "" }, 403], [{ "Content-Type": "text/plain" }, 415],
  ]) {
    const result = await fetch(`${base}/api/applications/export`, { method: "POST", headers: { ...headers, ...changes } });
    assert.equal(result.status, expected);
  }
  assert.equal(await rawStatus(`/api/applications/export?token=${"a".repeat(64)}`, "GET", { Host: "attacker.invalid" }), 403);
  assert.equal(await rawStatus("/api/applications/export", "POST", { Host: "attacker.invalid" }), 403);
  assert.equal(await rawStatus("/api/applications/import/upload", "POST", { Host: "attacker.invalid" }, snapshot), 403);
  const malformed = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: streamed(true), duplex: "half" });
  assert.equal(malformed.status, 400, await malformed.clone().text());
  assert.ok(bytes > 10 * 1024 * 1024);
  await unchanged(baseline);
  bytes = 0;
  const result = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: streamed(false), duplex: "half" });
  assert.equal(result.status, 201, await result.clone().text());
  const stage = await result.json();
  assert.equal(stage.applications, 5002);
  assert.equal(stage.contacts, 40000);
  assert.ok(bytes > 10 * 1024 * 1024);
  assert.match(stage.token, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(stage).includes("/tmp/"), false);
  assert.equal(result.headers.get("cache-control"), "no-store");
  await unchanged(baseline);
  const busy = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: snapshot });
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get("retry-after"), "1");
  const busyExport = await fetch(`${base}/api/applications/export`, { method: "POST", headers });
  assert.equal(busyExport.status, 503);
  assert.equal(busyExport.headers.get("retry-after"), "1");
  const page = await fetch(`${base}/api/applications/import/${stage.token}?after=-1`);
  const pageBody = await page.json();
  assert.equal(pageBody.applications.length, 200);
  assert.equal(pageBody.total, 5002);
  assert.equal("contacts" in pageBody.applications[0], false);
  const forbiddenCancel = await fetch(`${base}/api/applications/import/${stage.token}`, { method: "DELETE", headers: { ...headers, Origin: "http://attacker.invalid" } });
  assert.equal(forbiddenCancel.status, 403);
  await cancel(stage.token);
  assert.equal((await fetch(`${base}/api/applications/import/${stage.token}`)).status, 404);
  await unchanged(baseline);
  const second = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: snapshot });
  assert.equal(second.status, 201);
  await cancel((await second.json()).token);
  // Close an actual HTTP connection mid-body, then issue the next operation after its close event.
  await new Promise((resolve, reject) => {
    const url = new URL(base);
    const outgoing = http.request({ hostname: url.hostname, port: url.port, path: "/api/applications/import/upload", method: "POST", headers }, (response) => {
      response.resume(); reject(new Error(`Partial upload unexpectedly responded ${response.statusCode}`));
    });
    outgoing.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
    outgoing.on("close", resolve);
    outgoing.write('{"version":1,"applications":[', async () => {
      try {
        const started = Date.now();
        while (true) {
          const probe = await fetch(`${base}/api/applications/export`, { method: "POST", headers });
          if (probe.status === 503) { await probe.text(); break; }
          assert.equal(probe.status, 200);
          const { token } = await probe.json();
          await (await fetch(`${base}/api/applications/export?token=${token}`)).arrayBuffer();
          assert.ok(Date.now() - started < 5000, "Partial upload must acquire backup admission");
          await delay(20);
        }
        outgoing.destroy();
      } catch (error) { outgoing.destroy(); reject(error); }
    });
  });
  const disconnectedAt = Date.now();
  while (true) {
    const next = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: snapshot });
    if (next.status === 201) { await cancel((await next.json()).token); break; }
    await next.text();
    assert.equal(next.status, 503);
    assert.ok(Date.now() - disconnectedAt < 5000, "Disconnected upload must release admission after cleanup");
    await delay(20);
  }
  await unchanged(baseline);
  // Step 3: commit the exact large upload, with a real client disconnection after its write lock starts.
  const largeUpload = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: streamed(false), duplex: "half" });
  assert.equal(largeUpload.status, 201, await largeUpload.clone().text());
  const committedStage = await largeUpload.json();
  const { DatabaseSync } = await import("node:sqlite");
  const probe = new DatabaseSync(process.env.DATABASE_URL.slice(5));
  probe.exec("PRAGMA busy_timeout = 0");
  const hasWriter = () => {
    try { probe.exec("BEGIN IMMEDIATE; ROLLBACK"); return false; }
    catch (error) { if (error.errcode === 5 || /locked|busy/i.test(error.message)) return true; throw error; }
  };
  try {
    await new Promise((resolve, reject) => {
      const url = new URL(base);
      const outgoing = http.request({ hostname: url.hostname, port: url.port, path: "/api/applications/import", method: "POST", headers }, (response) => {
        response.resume(); reject(new Error(`Commit unexpectedly completed before disconnection: ${response.statusCode}`));
      });
      outgoing.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
      outgoing.on("close", resolve);
      outgoing.end(JSON.stringify({ token: committedStage.token }));
      void (async () => {
        const started = Date.now();
        while (!hasWriter()) {
          assert.ok(Date.now() - started < 10000, "Commit must acquire its serialized write transaction");
          await delay(5);
        }
        outgoing.destroy();
      })().catch((error) => { outgoing.destroy(); reject(error); });
    });
  } finally { probe.close(); }
  let outcome;
  const commitStarted = Date.now();
  while (true) {
    const status = await fetch(`${base}/api/applications/import/${committedStage.token}?status=1`);
    assert.equal(status.status, 200, await status.clone().text());
    outcome = await status.json();
    if (outcome.state !== "committing") break;
    assert.ok(Date.now() - commitStarted < 90000, "Disconnected commit must settle");
    await delay(50);
  }
  assert.equal(outcome.state, "complete", JSON.stringify(outcome));
  assert.equal(outcome.result.created, 5002);
  assert.equal(outcome.result.skipped, 0);
  assert.ok(JSON.stringify(outcome).length < 2000, "Commit result must contain bounded metadata, not records");
  assert.equal(await prisma.application.count(), 5002);
  assert.equal(await prisma.contact.count(), 40000);
  assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: "api-contact-39999" } })).notes, "x".repeat(200));
  const beforeRetry = await prisma.settings.findUnique({ where: { id: 1 } });
  const retry = await fetch(`${base}/api/applications/import`, { method: "POST", headers, body: JSON.stringify({ token: committedStage.token }) });
  assert.equal(retry.status, 201);
  assert.deepEqual(await retry.json(), outcome.result);
  assert.deepEqual(await prisma.settings.findUnique({ where: { id: 1 } }), beforeRetry, "Reconnect must not repeat settings revision or insertion");
  let after = "";
  let refreshed = 0;
  while (true) {
    const page = await fetch(`${base}/api/applications?paged=1&after=${encodeURIComponent(after)}`);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const body = await page.json();
    assert.ok(body.applications.length <= 200);
    if (!body.applications.length) break;
    refreshed += body.applications.length;
    after = body.applications.at(-1).id;
  }
  assert.equal(refreshed, 5002);
  // A distinct session compares the dense record in deterministic child pages, ignoring array order.
  const denseContacts = await prisma.contact.findMany({ where: { applicationId: "api-dense" }, orderBy: { id: "desc" } });
  const identicalBody = JSON.stringify({ version: 1, settings, applications: [{ ...application("api-dense"), contacts: denseContacts.map(({ applicationId, ...child }) => { void applicationId; return child; }) }] });
  const identicalUpload = await fetch(`${base}/api/applications/import/upload`, { method: "POST", headers, body: identicalBody });
  assert.equal(identicalUpload.status, 201);
  const identicalToken = (await identicalUpload.json()).token;
  const identicalCommit = await fetch(`${base}/api/applications/import`, { method: "POST", headers, body: JSON.stringify({ token: identicalToken }) });
  assert.equal(identicalCommit.status, 201, await identicalCommit.clone().text());
  assert.equal((await identicalCommit.json()).skipped, 1);
  assert.equal(await prisma.contact.count(), 40000);
  const preparedExport = await fetch(`${base}/api/applications/export`, { method: "POST", headers });
  assert.equal(preparedExport.status, 200, await preparedExport.clone().text());
  const exportToken = (await preparedExport.json()).token;
  const download = await fetch(`${base}/api/applications/export?token=${exportToken}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(download.headers.get("cache-control"), "no-store");
  const exportedBytes = Buffer.from(await download.arrayBuffer());
  assert.ok(exportedBytes.length > 10 * 1024 * 1024);
  const exportedSnapshot = JSON.parse(exportedBytes);
  assert.equal(exportedSnapshot.applications.length, 5002);
  assert.equal(exportedSnapshot.applications.find(({ id }) => id === "api-dense").contacts.length, 40000);
  assert.equal((await fetch(`${base}/api/applications/export?token=${exportToken}`)).status, 404);
  console.log(JSON.stringify({ downloadedBytes: exportedBytes.length, exportedApplications: 5002, exportedContacts: 40000 }));
  console.log(JSON.stringify({ uploadedBytes: bytes, applications: stage.applications, contacts: stage.contacts,
    passed: "raw Host/Origin/content type, large chunked staging, late-malformed atomicity, retryable admission, paged review, cancellation, connection close" }));
} finally { await prisma.$disconnect(); }
