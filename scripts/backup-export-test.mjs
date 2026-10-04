import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { prepareBackupExport, downloadBackupExport } from "../src/lib/backup-export.ts";
import { validateBackupStream } from "../src/lib/backup-stream-validator.ts";
import { stageBackupUpload, cancelStagedBackup } from "../src/lib/backup-staging.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";

async function fixture(contacts = 0) {
  const directory = await mkdtemp(join(tmpdir(), "nook-export-test-"));
  const path = join(directory, "live.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE Application (id TEXT PRIMARY KEY, company TEXT, role TEXT, status TEXT, archived INTEGER, revision INTEGER, source TEXT, appliedDate INTEGER, interviewDatePromptDismissed INTEGER, followUpDate INTEGER, followUpNote TEXT, lastUpdated INTEGER, notes TEXT, jobUrl TEXT, createdAt INTEGER);
    CREATE TABLE Settings (id INTEGER PRIMARY KEY, value TEXT, revision INTEGER);
    CREATE TABLE ApplicationEvent (id TEXT PRIMARY KEY, applicationId TEXT, type TEXT, detail TEXT, fromStatus TEXT, toStatus TEXT, createdAt INTEGER);
    CREATE TABLE Interview (id TEXT PRIMARY KEY, applicationId TEXT, date INTEGER, time TEXT, type TEXT, interviewers TEXT, notes TEXT, createdAt INTEGER);
    CREATE TABLE Contact (id TEXT PRIMARY KEY, applicationId TEXT, name TEXT, role TEXT, email TEXT, linkedinUrl TEXT, notes TEXT, createdAt INTEGER);`);
  const date = Date.parse("2026-09-01T00:00:00.000Z");
  db.prepare("INSERT INTO Application VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("one", "Before", "Engineer", "APPLIED", 1, 4, null, date, 0, null, null, date, "日本語 😀", null, date);
  db.prepare("INSERT INTO Settings VALUES (1, ?, 9)").run(JSON.stringify(defaultSettings));
  db.prepare("INSERT INTO ApplicationEvent VALUES ('event', 'one', 'STATUS_CHANGE', 'null → APPLIED', NULL, 'APPLIED', ?)").run(date);
  db.prepare("INSERT INTO Interview VALUES ('round', 'one', ?, '09:30', 'PHONE', 'Alice', NULL, ?)").run(date, date);
  const insert = db.prepare("INSERT INTO Contact VALUES (?, 'one', 'Alice', NULL, NULL, NULL, ?, ?)");
  db.exec("BEGIN");
  for (let i = 0; i < contacts; i++) insert.run(`contact-${String(i).padStart(8, "0")}`, "x".repeat(300), date);
  db.exec("COMMIT");
  return { directory, path, db, async cleanup() { db.close(); await rm(directory, { recursive: true }); } };
}

test("validated private export streams exact bytes, round trips through staging, consumes token and cleans artifacts", async () => {
  const f = await fixture(200);
  try {
    const prepared = await prepareBackupExport(f.path);
    assert.equal(prepared.applications, 1);
    const directory = globalThis.nookBackupExport.directory;
    for (const name of ["snapshot.sqlite", "backup.json", "validation.sqlite", "owner.json"]) assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const expected = await readFile(join(directory, "backup.json"));
    await assert.rejects(prepareBackupExport(f.path), e => e.status === 503);
    await assert.rejects(downloadBackupExport("wrong"), e => e.status === 404);
    const response = await downloadBackupExport(prepared.token);
    assert.match(response.headers.get("Content-Disposition"), /^attachment;/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const actual = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(actual, expected);
    assert.equal(Number(response.headers.get("Content-Length")), actual.length);
    const snapshot = JSON.parse(actual);
    assert.equal(snapshot.applications[0].archived, true);
    assert.equal(snapshot.applications[0].events.length, 1);
    assert.equal(snapshot.applications[0].interviews.length, 1);
    assert.equal(snapshot.applications[0].contacts.length, 200);
    assert.equal("revision" in snapshot.applications[0], false);
    assert.deepEqual(snapshot.settings, defaultSettings);
    const staged = await stageBackupUpload(new Request("http://localhost/api/applications/import/upload", { method: "POST", body: actual }));
    assert.equal(staged.contacts, 200);
    await cancelStagedBackup(staged.token);
    await assert.rejects(stat(directory), { code: "ENOENT" });
    await assert.rejects(downloadBackupExport(prepared.token), e => e.status === 404);
  } finally { await f.cleanup(); }
});

test("invalid stored settings, history, orphan children and empty IDs fail explicitly without changing the source", async () => {
  const f = await fixture();
  try {
    for (const value of ['{bad', JSON.stringify({ ...defaultSettings, theme: "neon" }), JSON.stringify(defaultSettings).replace('{', '{"theme":"dark",')]) {
      f.db.prepare("UPDATE Settings SET value = ?").run(value);
      await assert.rejects(prepareBackupExport(f.path), e => e.status === 500 && /stored data/.test(e.message));
      assert.equal(f.db.prepare("SELECT value FROM Settings").get().value, value);
      assert.equal(globalThis.nookBackupOperation, undefined);
    }
    f.db.prepare("UPDATE Settings SET value = ?").run(JSON.stringify(defaultSettings));
    f.db.exec("UPDATE ApplicationEvent SET detail = 'invalid'");
    await assert.rejects(prepareBackupExport(f.path), e => e.status === 500);
    f.db.exec("UPDATE ApplicationEvent SET detail = 'null → APPLIED'; INSERT INTO Contact VALUES ('orphan', 'missing', 'Alice', NULL, NULL, NULL, NULL, 1788220800000)");
    await assert.rejects(prepareBackupExport(f.path), e => e.status === 500);
    f.db.exec("DELETE FROM Contact WHERE id = 'orphan'; UPDATE Application SET createdAt = '2026-02-30T00:00:00.000Z'");
    await assert.rejects(prepareBackupExport(f.path), e => e.status === 500);
    f.db.exec("UPDATE Application SET createdAt = 1788220800000, id = ''");
    await assert.rejects(prepareBackupExport(f.path), e => e.status === 500);
  } finally { await f.cleanup(); }
});

test("download cancellation, preparation abort and expiration release admission and clean private artifacts", async () => {
  const f = await fixture(1000);
  try {
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(prepareBackupExport(f.path, aborted.signal), e => e.status === 400);
    assert.equal(globalThis.nookBackupOperation, undefined);
    let prepared = await prepareBackupExport(f.path);
    let directory = globalThis.nookBackupExport.directory;
    const response = await downloadBackupExport(prepared.token);
    await response.body.cancel();
    await assert.rejects(stat(directory), { code: "ENOENT" });
    prepared = await prepareBackupExport(f.path);
    directory = globalThis.nookBackupExport.directory;
    const stalledResponse = await downloadBackupExport(prepared.token);
    const stalled = globalThis.nookBackupExport;
    const timeout = stalled.timer._onTimeout;
    clearTimeout(stalled.timer);
    await timeout();
    await assert.rejects(stalledResponse.arrayBuffer(), e => e.status === 408);
    await assert.rejects(stat(directory), { code: "ENOENT" });
    prepared = await prepareBackupExport(f.path);
    directory = globalThis.nookBackupExport.directory;
    const current = globalThis.nookBackupExport;
    const expire = current.timer._onTimeout;
    clearTimeout(current.timer);
    await expire();
    // Timer callbacks schedule cleanup; await the actual cleanup promise.
    await current.cleanup;
    await assert.rejects(stat(directory), { code: "ENOENT" });
    await assert.rejects(downloadBackupExport(prepared.token), e => e.status === 404);
  } finally { await f.cleanup(); }
});

test("a dense export over 10 MiB remains responsive and keeps application/settings from the same snapshot during edits", async () => {
  const f = await fixture(40000);
  const directory = await mkdtemp(join(tmpdir(), "nook-export-worker-test-"));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  const worker = new Worker(join(process.cwd(), "src/workers/backup-staging-loader.mjs"), { workerData: { export: true, directory, database: f.path }, execArgv: [] });
  try {
    const result = await new Promise((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", message => {
        if (message.type === "snapshot") {
          f.db.exec("BEGIN; UPDATE Application SET company = 'After';");
          f.db.prepare("UPDATE Settings SET value = ?").run(JSON.stringify({ ...defaultSettings, theme: "dark" }));
          f.db.exec("COMMIT");
        } else if (message.error) reject(new Error(message.error)); else resolve(message.counts);
      });
    });
    assert.equal(result.contacts, 40000);
    assert.ok(ticks > 20);
    const bytes = await readFile(join(directory, "backup.json"));
    assert.ok(bytes.length > 10 * 1024 * 1024);
    const snapshot = JSON.parse(bytes);
    assert.equal(snapshot.applications[0].company, "Before");
    assert.equal(snapshot.settings.theme, defaultSettings.theme);
    const validated = await validateBackupStream((async function* () { yield bytes; })());
    assert.equal(validated.contacts, 40000);
    console.log(JSON.stringify({ exportBytes: bytes.length, eventLoopTicks: ticks, contacts: result.contacts }));
  } finally { clearInterval(timer); await worker.terminate(); await f.cleanup(); await rm(directory, { recursive: true }); }
});
