import assert from "node:assert/strict";
import { test, mock } from "node:test";
import * as fs from "node:fs/promises";
import * as threads from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { defaultSettings } from "../src/lib/settings-defaults.ts";

let admissionLow = true;
let workerFailure = "";
let initializationGate;
mock.module("node:fs/promises", { namedExports: { ...fs,
  mkdtemp: async (...args) => { if (initializationGate) await initializationGate; return fs.mkdtemp(...args); },
  statfs: async (...args) => admissionLow ? { bavail: 0, bsize: 4096 } : fs.statfs(...args),
} });
class StorageWorker extends threads.Worker {
  constructor(filename, options) {
    const injection = workerFailure === "crash" ? `throw new Error("private worker diagnostic");` : workerFailure === "export-write" ? `
      const fs = require("node:fs/promises");
      const original = fs.open;
      fs.open = async (...args) => {
        const handle = await original(...args); const write = handle.writeFile.bind(handle); let writes = 0;
        handle.writeFile = (...values) => {
          if (++writes === 2) throw Object.assign(new Error("private storage diagnostic"), { code: "ENOSPC" });
          return write(...values);
        };
        return handle;
      };
      require("node:module").syncBuiltinESMExports();
    ` : workerFailure === "chunk" ? `
      const fs = require("node:fs"); let calls = 0;
      const original = fs.statfsSync;
      fs.statfsSync = (...args) => ++calls > 1 ? { bavail: 0, bsize: 4096 } : original(...args);
      require("node:module").syncBuiltinESMExports();
    ` : `
      const { DatabaseSync } = require("node:sqlite"); let writes = 0;
      const original = DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare = function(...args) {
        const statement = original.apply(this, args); const run = statement.run.bind(statement);
        statement.run = (...values) => {
          if (++writes === 100) throw Object.assign(new Error("private storage diagnostic"), { code: "ERR_SQLITE_ERROR", errcode: 13 });
          return run(...values);
        };
        return statement;
      };
    `;
    super(`${injection} import(${JSON.stringify(pathToFileURL(filename).href)}).catch(() => process.exit(1));`, { ...options, eval: true });
  }
}
mock.module("node:worker_threads", { namedExports: { ...threads, Worker: StorageWorker } });
const { stageBackupUpload } = await import("../src/lib/backup-staging.ts");
test("upload inactivity also covers initialization and cleans artifacts created after expiry", async (t) => {
  admissionLow = false;
  const existing = await fs.readdir(tmpdir());
  let release;
  initializationGate = new Promise((resolve) => { release = resolve; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = stageBackupUpload(new Request("http://localhost/api/applications/import/upload", {
      method: "POST", body: JSON.stringify({ version: 1, settings: defaultSettings, applications: [] }),
    }));
    const rejected = assert.rejects(pending, (error) => error.status === 408);
    t.mock.timers.tick(60001);
    release();
    await rejected;
    assert.equal(globalThis.nookBackupOperation, undefined);
    assert.deepEqual((await fs.readdir(tmpdir())).filter((name) => name.startsWith("nook-backup-stage-") && !existing.includes(name)), []);
  } finally {
    release();
    initializationGate = undefined;
    admissionLow = true;
    t.mock.timers.reset();
  }
});
test("insufficient temporary storage fails explicitly without admitting another operation or retaining artifacts", async () => {
  const existing = await fs.readdir(tmpdir());
  const body = JSON.stringify({ version: 1, settings: defaultSettings, applications: [] });
  await assert.rejects(stageBackupUpload(new Request("http://localhost/api/applications/import/upload", { method: "POST", body })), (error) => error.status === 507);
  assert.equal(globalThis.nookBackupOperation, undefined);
  const added = (await fs.readdir(tmpdir())).filter((name) => name.startsWith("nook-backup-stage-") && !existing.includes(name));
  assert.deepEqual(added, []);
});


for (const failure of ["chunk", "sqlite"]) test(`storage failure after partial staging (${failure}) returns 507 and removes its own artifacts`, async () => {
  admissionLow = false;
  workerFailure = failure;
  const date = "2026-09-01T00:00:00.000Z";
  const applications = Array.from({ length: 500 }, (_, index) => ({ id: `storage-${index}`, company: "Storage", role: "Engineer", status: "APPLIED", archived: false,
    source: null, appliedDate: date, followUpDate: null, followUpNote: null, interviews: [], contacts: [], interviewDatePromptDismissed: false,
    notes: null, jobUrl: null, createdAt: date, lastUpdated: date, events: [] }));
  const existing = await fs.readdir(tmpdir());
  await assert.rejects(stageBackupUpload(new Request("http://localhost/api/applications/import/upload", { method: "POST",
    body: JSON.stringify({ version: 1, settings: defaultSettings, applications }) })), (error) => error.status === 507 && !error.message.includes("private"));
  assert.equal(globalThis.nookBackupOperation, undefined);
  assert.deepEqual((await fs.readdir(tmpdir())).filter((name) => name.startsWith("nook-backup-stage-") && !existing.includes(name)), []);
});

const { prepareBackupExport } = await import("../src/lib/backup-export.ts");
for (const failure of ["admission", "export-write", "crash"]) test(`export ${failure} failure cleans artifacts, keeps source intact, and releases admission`, async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { join } = await import("node:path");
  const directory = await fs.mkdtemp(join(tmpdir(), "nook-export-storage-"));
  const path = join(directory, "source.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE Application (id TEXT PRIMARY KEY);
      CREATE TABLE Settings (id INTEGER PRIMARY KEY, value TEXT);
      CREATE TABLE ApplicationEvent (id TEXT PRIMARY KEY, applicationId TEXT);
      CREATE TABLE Interview (id TEXT PRIMARY KEY, applicationId TEXT);
      CREATE TABLE Contact (id TEXT PRIMARY KEY, applicationId TEXT);`);
    const settings = JSON.stringify(defaultSettings);
    db.prepare("INSERT INTO Settings VALUES (1, ?)").run(settings);
    admissionLow = failure === "admission";
    workerFailure = failure;
    const existing = await fs.readdir(tmpdir());
    await assert.rejects(prepareBackupExport(path), e => e.status === (failure === "crash" ? 500 : 507) && !e.message.includes("private"));
    assert.equal(globalThis.nookBackupOperation, undefined);
    assert.equal(db.prepare("SELECT value FROM Settings").get().value, settings);
    assert.deepEqual((await fs.readdir(tmpdir())).filter(name => name.startsWith("nook-backup-stage-") && !existing.includes(name)), []);
  } finally { db.close(); await fs.rm(directory, { recursive: true }); }
});
