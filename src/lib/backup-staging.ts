import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, statfs, writeFile, readFile, readdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { BackupSnapshot } from "@/lib/backup-snapshot";
import type { validateBackupStream } from "@/lib/backup-stream-validator";
import { WriteQueueFullError } from "@/lib/write-queue";

const STALL_MS = 60_000;
const REVIEW_MS = 30 * 60_000;
export type Counts = Awaited<ReturnType<typeof validateBackupStream>>;

// Resolve the loader relative to the local project at runtime, independent of Next's generated chunk paths. Turbopack
// bundles every worker constructor call it can analyze (ignore comments included) and replaces the loader's runtime TypeScript
// import with a "too dynamic" error, so the constructor is called indirectly.
export function startBackupWorker(workerData: object): Worker {
  return Reflect.construct(Worker, [join(process.cwd(), "src/workers/backup-staging-loader.mjs"), { workerData, execArgv: [] }]);
}
export type StagedApplication = Omit<BackupSnapshot["applications"][number], "events" | "contacts" | "interviews"> & { position: number };
type State = "uploading" | "validating" | "reviewing" | "committing";
type Operation = {
  token: string; directory?: string; worker?: Worker; state: State; counts?: Counts;
  timer?: NodeJS.Timeout; failure?: BackupOperationError; sequence: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  disposing?: Promise<void>; cancelRead?: () => void;
  reviewPrepared?: Promise<void>;
  ready?: () => void; rejectReady?: (error: Error) => void;
};
export type BackupCommitResult = { created: number; skipped: number; settings: Counts["settings"]; settingsRevision: number };
type Outcome = { state: "complete"; result: BackupCommitResult } | { state: "failed"; error: string; status: number; conflicts?: string[] };
const shared = globalThis as unknown as { nookBackupOperation?: Operation | "export"; nookBackupOutcomes?: Map<string, Outcome> };
const outcomes = shared.nookBackupOutcomes ??= new Map<string, Outcome>();

export class BackupOperationError extends Error {
  readonly status: number;
  readonly conflicts?: string[];
  constructor(message: string, status: number, conflicts?: string[]) { super(message); this.status = status; this.conflicts = conflicts; }
}
export function beginBackupExport() {
  if (shared.nookBackupOperation) throw busy();
  shared.nookBackupOperation = "export";
  return () => { if (shared.nookBackupOperation === "export") shared.nookBackupOperation = undefined; };
}
function busy() { return new BackupOperationError("A backup operation is already active. Please try again shortly.", 503); }
function operation(token: string) {
  const current = shared.nookBackupOperation;
  if (!current || current === "export" || current.token !== token) throw new BackupOperationError("Backup session not found or expired", 404);
  return current;
}
function arm(current: Operation, duration: number) {
  clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    stop(current, new BackupOperationError(duration === STALL_MS ? "Backup upload stalled for 60 seconds" : "Backup review expired", duration === STALL_MS ? 408 : 410));
  }, duration);
  current.timer.unref();
}
function fail(current: Operation, failure: BackupOperationError) {
  current.failure ??= failure;
  clearTimeout(current.timer);
  current.rejectReady?.(current.failure);
  for (const request of current.pending.values()) request.reject(current.failure);
  current.pending.clear();
  current.cancelRead?.();
}
function stop(current: Operation, failure: BackupOperationError) {
  fail(current, failure);
  // The upload owns initialization and cleanup, including an abort during mkdtemp.
  if (current.state === "reviewing") void dispose(current).catch(() => { console.error("Backup staging cleanup failed"); });
}
function dispose(current: Operation, failure = new BackupOperationError("Backup cancelled", 409)): Promise<void> {
  if (current.disposing) return current.disposing;
  fail(current, failure);
  current.disposing = (async () => {
    await current.worker?.terminate();
    if (current.directory) await rm(current.directory, { recursive: true, force: true });
    if (shared.nookBackupOperation === current) shared.nookBackupOperation = undefined;
  })().catch((error) => { current.disposing = undefined; throw error; });
  return current.disposing;
}
function call<T>(current: Operation, type: string, fields: Record<string, unknown> = {}): Promise<T> {
  if (current.failure) return Promise.reject(current.failure);
  return new Promise((resolve, reject) => {
    const id = ++current.sequence;
    current.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    current.worker!.postMessage({ id, type, ...fields });
  });
}

export async function stageBackupUpload(request: Request) {
  if (shared.nookBackupOperation) throw busy();
  if (!request.body) throw new BackupOperationError("Backup body is required", 400);
  // Reject an unavailable stream before taking shared admission.
  if (request.body.locked || request.bodyUsed) throw new BackupOperationError("Backup body is already in use", 400);
  const reader = request.body.getReader();
  const current: Operation = { token: randomBytes(32).toString("hex"), state: "uploading", sequence: 0, pending: new Map() };
  shared.nookBackupOperation = current;
  const abort = () => { stop(current, new BackupOperationError("Backup upload cancelled", 400)); };
  current.cancelRead = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new BackupOperationError("Backup upload cancelled", 400);
    arm(current, STALL_MS);
    current.directory = await mkdtemp(join(tmpdir(), "nook-backup-stage-"));
    await chmod(current.directory, 0o700);
    await writeFile(join(current.directory, "owner.json"), JSON.stringify({ project: process.cwd(), pid: process.pid }), { mode: 0o600, flag: "wx" });
    const storage = await statfs(current.directory);
    if (storage.bavail * storage.bsize < 8 * 1024 * 1024) throw new BackupOperationError("Not enough temporary storage for the backup", 507);
    if (current.failure) throw current.failure;
    const ready = new Promise<void>((resolve, reject) => { current.ready = resolve; current.rejectReady = reject; });
    current.worker = startBackupWorker({ directory: current.directory });
    current.worker.on("message", (message) => {
      if (message.type === "ready") current.ready?.();
      else if (message.type === "progress" && !current.failure && current.state !== "committing") arm(current, current.state === "reviewing" ? REVIEW_MS : STALL_MS);
      else if (message.type === "failure") stop(current, new BackupOperationError(message.error, message.status));
      else {
        const waiting = current.pending.get(message.id);
        current.pending.delete(message.id);
        if (message.error) waiting?.reject(new BackupOperationError(message.error, message.status));
        else waiting?.resolve(message.value);
      }
    });
    current.worker.on("error", () => { stop(current, new BackupOperationError("Backup staging worker failed", 500)); });
    current.worker.on("exit", () => { if (!current.failure) stop(current, new BackupOperationError("Backup staging worker stopped", 500)); });
    arm(current, STALL_MS);
    await ready;
    while (true) {
      // A read can stall independently of the worker; the operation timer cancels it.
      const cancelled = new Promise<never>((_, reject) => { current.pending.set(0, { resolve: () => undefined, reject }); });
      const next = await Promise.race([reader.read(), cancelled]);
      current.pending.delete(0);
      if (current.failure) throw current.failure;
      if (next.done) break;
      if (!next.value.byteLength) continue;
      arm(current, STALL_MS);
      for (let offset = 0; offset < next.value.byteLength; offset += 64 * 1024) {
        // One bounded message in flight; SQLite processing must acknowledge before reading more.
        await call(current, "chunk", { bytes: next.value.slice(offset, offset + 64 * 1024) });
      }
    }
    current.state = "validating";
    current.counts = await call<Counts>(current, "end");
    current.state = "reviewing";
    arm(current, REVIEW_MS);
    return { token: current.token, state: current.state, ...current.counts };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await dispose(current);
    if (error instanceof BackupOperationError) throw error;
    throw new BackupOperationError("Could not stage the backup. Check temporary storage and try again.", 500);
  } finally {
    request.signal.removeEventListener("abort", abort);
    current.cancelRead = undefined;
    reader.releaseLock();
  }
}

export async function readStagedPage(token: string, after: number) {
  const current = operation(token);
  if (current.state !== "reviewing") throw busy();
  arm(current, REVIEW_MS);
  const applications = await call<StagedApplication[]>(current, "page", { after });
  return { applications, total: current.counts!.applications };
}
export async function prepareDuplicateReview(token: string, populate: (add: (rows: Record<string, unknown>[]) => Promise<void>) => Promise<void>) {
  const current = operation(token);
  if (current.state !== "reviewing") throw busy();
  arm(current, REVIEW_MS);
  current.reviewPrepared ??= (async () => {
    await call(current, "review-start");
    await populate((rows) => call(current, "review-add", { rows }));
  })();
  await current.reviewPrepared;
}
export async function readStagedDuplicate<T>(token: string, position: number): Promise<T> {
  const current = operation(token);
  if (current.state !== "reviewing") throw busy();
  arm(current, REVIEW_MS);
  return call(current, "duplicate", { position });
}
export async function cancelStagedBackup(token: string) {
  const current = operation(token);
  if (current.state === "committing") throw busy();
  await dispose(current);
}
export function stagedOutcome(token: string) {
  const saved = outcomes.get(token);
  if (saved) return saved;
  const current = operation(token);
  return { state: current.state };
}
export type StagedReader = {
  counts: Counts;
  applications: (after: number) => Promise<StagedApplication[]>;
  children: (kind: "events" | "interviews" | "contacts", owner: number, cursor: string) => Promise<Record<string, unknown>[]>;
};
export async function withStagedBackup(token: string, commit: (reader: StagedReader) => Promise<BackupCommitResult>, signal?: AbortSignal) {
  const saved = outcomes.get(token);
  if (saved?.state === "complete") return saved.result;
  if (saved?.state === "failed") throw new BackupOperationError(saved.error, saved.status, saved.conflicts);
  const current = operation(token);
  if (current.state !== "reviewing") throw busy();
  if (signal?.aborted) { await dispose(current); throw new BackupOperationError("Backup cancelled before commit", 409); }
  current.state = "committing";
  clearTimeout(current.timer);
  try {
    const result = await commit({
      counts: current.counts!,
      applications: (after) => call(current, "page", { after }),
      children: (kind, owner, cursor) => call(current, "children", { kind, owner, cursor }),
    });
    outcomes.set(token, { state: "complete", result });
    return result;
  } catch (error) {
    const failure = error instanceof BackupOperationError ? error : error instanceof WriteQueueFullError
      ? new BackupOperationError("Database write queue is full. Please try again shortly.", 503)
      : new BackupOperationError("Backup commit failed; no applications or settings were imported", 500);
    outcomes.set(token, { state: "failed", error: failure.message, status: failure.status, ...(failure.conflicts && { conflicts: failure.conflicts }) });
    throw failure;
  } finally {
    const expiry = setTimeout(() => { outcomes.delete(token); }, REVIEW_MS);
    expiry.unref();
    await dispose(current).catch(() => { console.error("Backup staging cleanup failed"); });
  }
}

/** Remove only private, identified artifacts whose owning process is no longer alive. */
export async function cleanupAbandonedBackupStages() {
  const root = tmpdir();
  for (const name of await readdir(root)) {
    if (!/^nook-backup-stage-[A-Za-z0-9]+$/.test(name)) continue;
    const directory = join(root, name);
    try {
      const info = await lstat(directory);
      // Windows has no uid and no POSIX mode bits; there the owner marker alone identifies Nook's artifacts.
      const posix = process.platform !== "win32";
      if (!info.isDirectory() || (posix && (info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700))) continue;
      const marker = await lstat(join(directory, "owner.json"));
      if (!marker.isFile() || marker.size > 4096 || (posix && (marker.uid !== info.uid || (marker.mode & 0o777) !== 0o600))) continue;
      const owner = JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
      if (owner.project !== process.cwd() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
      try { process.kill(owner.pid, 0); continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue; }
      await rm(directory, { recursive: true });
    } catch { console.error("Abandoned backup staging cleanup failed"); }
  }
}
