import assert from "node:assert/strict";
import { test } from "node:test";
import { stat } from "node:fs/promises";
import { once } from "node:events";
import { stageBackupUpload, readStagedPage, cancelStagedBackup, beginBackupExport, withStagedBackup, stagedOutcome, cleanupAbandonedBackupStages } from "../src/lib/backup-staging.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";

const date = "2026-09-01T00:00:00.000Z";
const application = (id) => ({ id, company: "Acme", role: "Engineer", status: "APPLIED", archived: false,
  source: null, appliedDate: date, followUpDate: null, followUpNote: null, interviews: [], contacts: [], interviewDatePromptDismissed: false,
  notes: null, jobUrl: null, createdAt: date, lastUpdated: date, events: [] });
const backup = (records = [application("stage-app")]) => JSON.stringify({ version: 1, applications: records, settings: defaultSettings });
const request = (body, signal) => new Request("http://localhost/api/applications/import/upload", { method: "POST", body, signal, duplex: "half" });
const active = () => globalThis.nookBackupOperation;

function stream(source) {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream({ async pull(controller) {
    const value = await iterator.next();
    if (value.done) controller.close(); else controller.enqueue(new TextEncoder().encode(value.value));
  }, async cancel() { await iterator.return?.(); } });
}
async function* large(malformed = false) {
  yield `{"version":1,"settings":${JSON.stringify(defaultSettings)},"applications":[`;
  for (let index = 0; index < 5001; index++) yield `${index ? "," : ""}${JSON.stringify(application(`large-${index}`))}`;
  const dense = application("dense");
  delete dense.contacts;
  yield `,${JSON.stringify(dense).slice(0, -1)},"contacts":[`;
  for (let index = 0; index < 40000; index++) yield `${index ? "," : ""}${JSON.stringify({ id: `contact-${index}`, name: "Person", role: null, email: null, linkedinUrl: null, notes: "x".repeat(200), createdAt: date })}`;
  yield malformed ? "]}]}garbage" : "]}]}";
}

test("locked and consumed bodies cannot strand shared backup admission", async () => {
  const locked = request(backup());
  const reader = locked.body.getReader();
  await assert.rejects(stageBackupUpload(locked), (error) => error.status === 400);
  assert.equal(active(), undefined);
  reader.releaseLock();
  const consumed = request(backup());
  await consumed.text();
  await assert.rejects(stageBackupUpload(consumed), (error) => error.status === 400);
  assert.equal(active(), undefined);
  const staged = await stageBackupUpload(request(backup()));
  await cancelStagedBackup(staged.token);
});

test("worker stages beyond both former limits, pages scalars, enforces private modes and stays responsive", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  let bytes = 0;
  const source = async function* () { for await (const chunk of large()) { bytes += Buffer.byteLength(chunk); yield chunk; } };
  const result = await stageBackupUpload(request(stream(source())));
  clearInterval(timer);
  try {
    assert.ok(bytes > 10 * 1024 * 1024);
    assert.equal(result.applications, 5002);
    assert.equal(result.contacts, 40000);
    assert.ok(ticks > 20, "main event loop must remain responsive while the worker parses");
    const directory = active().directory;
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(`${directory}/validation.sqlite`)).mode & 0o777, 0o600);
    const page = await readStagedPage(result.token, -1);
    assert.equal(page.applications.length, 200);
    assert.equal("contacts" in page.applications[0], false);
    await assert.rejects(stageBackupUpload(request(backup())), (error) => error.status === 503);
    assert.throws(beginBackupExport, (error) => error.status === 503);
    console.log(JSON.stringify({ stagedBytes: bytes, ...result, token: undefined, eventLoopTicks: ticks }));
    await cancelStagedBackup(result.token);
    await assert.rejects(stat(directory), { code: "ENOENT" });
  } finally { if (active()) await cancelStagedBackup(result.token); }
});

test("late malformed large input cleans only its own staging directory", async () => {
  await assert.rejects(stageBackupUpload(request(stream(large(true)))), (error) => error.status === 400);
  assert.equal(active(), undefined);
});

test("abort, source failure, worker failure and review cancellation release admission", async () => {
  const controller = new AbortController();
  const pending = stageBackupUpload(request(new ReadableStream({}), controller.signal));
  const rejected = assert.rejects(pending, (error) => error.status === 400);
  controller.abort();
  await rejected;
  assert.equal(active(), undefined);
  await assert.rejects(stageBackupUpload(request(new ReadableStream({ start(controller) { controller.error(new Error("source failed")); } }))), (error) => error.status === 500);
  assert.equal(active(), undefined);
  const stalled = stageBackupUpload(request(new ReadableStream({})));
  const crashed = assert.rejects(stalled, (error) => error.status === 500);
  // Wait on the actual worker-ready event rather than polling filesystem/process state.
  const op = active();
  const originalReady = op.ready;
  await new Promise((resolve) => {
    const timer = setImmediate(function waitForInitialization() {
      if (!op.worker) { setImmediate(waitForInitialization); return; }
      once(op.worker, "message").then(resolve);
    });
    void timer; void originalReady;
  });
  const directory = op.directory;
  await op.worker.terminate();
  await crashed;
  await assert.rejects(stat(directory), { code: "ENOENT" });
  const release = beginBackupExport();
  await assert.rejects(stageBackupUpload(request(backup())), (error) => error.status === 503);
  release();
  const result = await stageBackupUpload(request(backup()));
  await cancelStagedBackup(result.token);
  assert.equal(active(), undefined);
});

test("60 seconds without upload progress cancels the reader and worker", async (t) => {
  const result = await stageBackupUpload(request(backup()));
  await cancelStagedBackup(result.token);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = stageBackupUpload(request(new ReadableStream({})));
  const rejected = assert.rejects(pending, (error) => error.status === 408);
  const op = active();
  await new Promise((resolve) => {
    setImmediate(function initialized() {
      if (!op.worker) { setImmediate(initialized); return; }
      once(op.worker, "message").then(resolve);
    });
  });
  t.mock.timers.tick(60001);
  await rejected;
  assert.equal(active(), undefined);
  t.mock.timers.reset();
});


test("review expiration and retained completion prevent repeated commits", async (t) => {
  const staged = await stageBackupUpload(request(backup()));
  let calls = 0;
  const result = await withStagedBackup(staged.token, async (reader) => {
    calls++;
    assert.equal((await reader.applications(-1)).length, 1);
    assert.deepEqual(await reader.children("contacts", 0, ""), []);
    return { created: 1, skipped: 0, settings: reader.counts.settings, settingsRevision: 1 };
  });
  assert.equal(active(), undefined);
  assert.deepEqual(stagedOutcome(staged.token), { state: "complete", result });
  assert.deepEqual(await withStagedBackup(staged.token, async () => { calls++; throw new Error("must not recommit"); }), result);
  assert.equal(calls, 1);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await stageBackupUpload(request(backup()));
  const directory = active().directory;
  t.mock.timers.tick(30 * 60_000 + 1);
  await active()?.disposing;
  assert.equal(active(), undefined);
  await assert.rejects(stat(directory), { code: "ENOENT" });
  t.mock.timers.reset();
});

test("worker progress keeps active review work alive without imposing a total processing duration", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const staged = await stageBackupUpload(request(backup()));
  const current = active();
  t.mock.timers.tick(29 * 60_000);
  current.worker.emit("message", { type: "progress" });
  t.mock.timers.tick(29 * 60_000);
  assert.equal(active(), current);
  assert.equal(current.failure, undefined);
  await cancelStagedBackup(staged.token);
  t.mock.timers.reset();
});

test("startup cleanup removes only this project's private dead-owner artifacts", async () => {
  const fs = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const owned = await fs.mkdtemp(join(tmpdir(), "nook-backup-stage-"));
  const foreign = await fs.mkdtemp(join(tmpdir(), "nook-backup-stage-"));
  try {
    for (const directory of [owned, foreign]) await fs.chmod(directory, 0o700);
    await fs.writeFile(join(owned, "owner.json"), JSON.stringify({ project: process.cwd(), pid: 2147483647 }), { mode: 0o600 });
    await fs.writeFile(join(foreign, "owner.json"), JSON.stringify({ project: "another-project", pid: 2147483647 }), { mode: 0o600 });
    await cleanupAbandonedBackupStages();
    await assert.rejects(fs.stat(owned), { code: "ENOENT" });
    assert.ok((await fs.stat(foreign)).isDirectory());
  } finally {
    await fs.rm(owned, { recursive: true, force: true });
    await fs.rm(foreign, { recursive: true, force: true });
  }
});


test("cancellation before commit and commit-reader failure clean artifacts and retain failure", async () => {
  const cancelled = await stageBackupUpload(request(backup()));
  const directory = active().directory;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withStagedBackup(cancelled.token, async () => { throw new Error("must not start commit"); }, controller.signal), (error) => error.status === 409);
  await assert.rejects(stat(directory), { code: "ENOENT" });
  assert.equal(active(), undefined);
  const failed = await stageBackupUpload(request(backup()));
  const failureDirectory = active().directory;
  await assert.rejects(withStagedBackup(failed.token, async () => { throw new Error("private database diagnostic"); }), (error) => error.status === 500 && !error.message.includes("private database diagnostic"));
  assert.equal(stagedOutcome(failed.token).state, "failed");
  await assert.rejects(stat(failureDirectory), { code: "ENOENT" });
  await assert.rejects(withStagedBackup(failed.token, async () => { throw new Error("must not repeat"); }), (error) => error.status === 500);
});

test("server code never writes `new Worker(...)`, which Turbopack bundles and breaks", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = (await readdir(new URL("../src", import.meta.url), { recursive: true })).filter((name) => /\.[cm]?[jt]sx?$/.test(name));
  for (const name of files) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bnew\s+Worker\s*\(/, `${name} must start workers through startBackupWorker`);
  }
});
