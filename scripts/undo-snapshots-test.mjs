import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("server-only", { namedExports: {} });
let stageCleanups = 0;
mock.module("../src/lib/backup-staging.ts", { namedExports: {
  cleanupAbandonedBackupStages: async () => { stageCleanups++; },
} });

test("Undo maintenance cleans at startup and each interval, serializes writes, and recovers safely", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nook-undo-maintenance-"));
  const previousUrl = process.env.DATABASE_URL;
  const previousRuntime = process.env.NEXT_RUNTIME;
  const previousPhase = process.env.NEXT_PHASE;
  process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
  const { prisma, serializeWrite } = await import("../src/lib/prisma.ts");
  const { cleanupExpiredUndoSnapshots, startUndoSnapshotMaintenance } = await import("../src/lib/undo-snapshots.ts");
  const { register } = await import("../src/instrumentation.ts");
  const timers = [];
  const warnings = [];
  t.mock.method(globalThis, "setInterval", (callback, delay) => {
    const timer = { callback, delay, unreferenced: false, unref() { this.unreferenced = true; } };
    timers.push(timer);
    return timer;
  });
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const seed = (token, expiresAt) => prisma.undoSnapshot.create({ data: {
    token, applicationId: token, payload: "private recovery payload", expiresAt,
  } });
  const count = (token) => prisma.undoSnapshot.count({ where: { token } });
  let release;
  try {
    await prisma.$executeRawUnsafe('CREATE TABLE "UndoSnapshot" ("token" TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "payload" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL)');
    await prisma.$executeRawUnsafe('CREATE INDEX "UndoSnapshot_expiresAt_idx" ON "UndoSnapshot" ("expiresAt")');
    await seed("startup-expired", new Date(0));
    await seed("valid", new Date(Date.now() + 600_000));
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    await register();
    assert.equal(timers.length, 0, "Build instrumentation must not start maintenance");
    assert.equal(stageCleanups, 0);
    assert.equal(await count("startup-expired"), 1);
    delete process.env.NEXT_PHASE;
    process.env.NEXT_RUNTIME = "edge";
    await register();
    assert.equal(timers.length, 0, "Edge instrumentation must not start maintenance");
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    assert.equal(await count("startup-expired"), 0, "Registration awaits actual SQLite startup cleanup");
    assert.equal(await count("valid"), 1);
    assert.equal(stageCleanups, 1, "Existing staging startup cleanup is preserved");
    await Promise.all([startUndoSnapshotMaintenance(), startUndoSnapshotMaintenance()]);
    const reloaded = await import("../src/lib/undo-snapshots.ts?reload");
    await reloaded.startUndoSnapshotMaintenance();
    assert.equal(timers.length, 1, "Concurrent starts and module reloads share one process timer");
    assert.equal(timers[0].delay, 60_000);
    assert.equal(timers[0].unreferenced, true);

    await seed("interval-expired", new Date(0));
    timers[0].callback();
    await globalThis.undoSnapshotCleanup;
    assert.equal(await count("interval-expired"), 0, "Ordinary maintenance needs no delete or restore request");
    assert.equal(await count("valid"), 1);

    const boundary = new Date("2026-01-01T00:00:00.000Z");
    await seed("boundary", boundary);
    await seed("after-boundary", new Date(boundary.getTime() + 1));
    await cleanupExpiredUndoSnapshots(boundary);
    assert.equal(await count("boundary"), 0, "Expiry includes the exact boundary");
    assert.equal(await count("after-boundary"), 1);

    let entered;
    const enteredQueue = new Promise((resolve) => { entered = resolve; });
    const heldWrite = serializeWrite(async () => {
      entered();
      await new Promise((resolve) => { release = resolve; });
    });
    await enteredQueue;
    await seed("blocked-expired", new Date(0));
    timers[0].callback();
    const pending = globalThis.undoSnapshotCleanup;
    timers[0].callback();
    assert.equal(globalThis.undoSnapshotCleanup, pending, "Ticks cannot overlap or accumulate queued cleanup");
    assert.equal(cleanupExpiredUndoSnapshots(), pending, "Request cleanup shares the running maintenance");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await count("blocked-expired"), 1, "Cleanup waits behind the existing write queue");
    release();
    await heldWrite;
    await pending;
    assert.equal(await count("blocked-expired"), 0);

    await seed("failure-expired", new Date(0));
    await prisma.$executeRawUnsafe("CREATE TRIGGER cleanup_failure BEFORE DELETE ON UndoSnapshot BEGIN SELECT RAISE(ABORT, 'private diagnostic and recovery payload'); END");
    timers[0].callback();
    await globalThis.undoSnapshotCleanup;
    assert.equal(await count("failure-expired"), 1);
    assert.deepEqual(warnings, [["Expired undo snapshot cleanup failed; retrying on the next maintenance interval"]], "Cleanup logs no error object, SQL, paths, or payloads");
    assert.equal(globalThis.undoSnapshotCleanup, undefined, "Failure releases the running guard");
    await prisma.$executeRawUnsafe("DROP TRIGGER cleanup_failure");
    timers[0].callback();
    await globalThis.undoSnapshotCleanup;
    assert.equal(await count("failure-expired"), 0, "The next interval retries after database failure");
    assert.equal(await count("valid"), 1);

    // Simulate a fresh process's startup attempt using the same isolated database.
    delete globalThis.undoSnapshotMaintenance;
    delete globalThis.undoSnapshotTimer;
    await seed("startup-failure", new Date(0));
    await prisma.$executeRawUnsafe("CREATE TRIGGER cleanup_failure BEFORE DELETE ON UndoSnapshot BEGIN SELECT RAISE(ABORT, 'private startup diagnostic'); END");
    await startUndoSnapshotMaintenance();
    assert.equal(await count("startup-failure"), 1);
    assert.equal(timers.length, 2, "A failed startup attempt still schedules the next interval");
    assert.equal(warnings.length, 2);
    assert.deepEqual(warnings[1], warnings[0]);
    await prisma.$executeRawUnsafe("DROP TRIGGER cleanup_failure");
    timers[1].callback();
    await globalThis.undoSnapshotCleanup;
    assert.equal(await count("startup-failure"), 0);
  } finally {
    release?.();
    await globalThis.undoSnapshotCleanup;
    await prisma.$disconnect();
    delete globalThis.undoSnapshotCleanup;
    delete globalThis.undoSnapshotMaintenance;
    delete globalThis.undoSnapshotTimer;
    for (const [name, value] of [["DATABASE_URL", previousUrl], ["NEXT_RUNTIME", previousRuntime], ["NEXT_PHASE", previousPhase]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
