import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, rm, stat, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import { beginBackupExport, BackupOperationError, startBackupWorker, type Counts } from "@/lib/backup-staging";

type Export = { token: string; directory: string; release: () => void; timer?: NodeJS.Timeout; downloading: boolean; cleanup?: Promise<void> };
const shared = globalThis as unknown as { nookBackupExport?: Export };
async function dispose(current: Export) {
  clearTimeout(current.timer);
  current.cleanup ??= rm(current.directory, { recursive: true, force: true }).then(() => {
    if (shared.nookBackupExport === current) shared.nookBackupExport = undefined;
    current.release();
  }).catch((error) => { current.cleanup = undefined; throw error; });
  await current.cleanup;
}

export async function prepareBackupExport(database: string, signal?: AbortSignal) {
  const release = beginBackupExport();
  let current: Export | undefined;
  let worker: Worker | undefined;
  try {
    const directory = await mkdtemp(join(tmpdir(), "nook-backup-stage-"));
    current = { token: randomBytes(32).toString("hex"), directory, release, downloading: false };
    await chmod(directory, 0o700);
    await writeFile(join(directory, "owner.json"), JSON.stringify({ project: process.cwd(), pid: process.pid }), { mode: 0o600, flag: "wx" });
    const storage = await statfs(directory);
    if (storage.bavail * storage.bsize < 8 * 1024 * 1024) throw new BackupOperationError("Not enough temporary storage for the export", 507);
    if (signal?.aborted) throw new BackupOperationError("Export cancelled", 400);
    worker = startBackupWorker({ export: true, directory, database });
    const counts = await new Promise<Counts>((resolve, reject) => {
      const abort = () => reject(new BackupOperationError("Export cancelled", 400));
      signal?.addEventListener("abort", abort, { once: true });
      const finish = () => signal?.removeEventListener("abort", abort);
      worker!.on("message", (message) => {
        if (message.type === "snapshot") return;
        finish();
        if (message.error) reject(new BackupOperationError(message.error, message.status));
        else resolve(message.counts);
      });
      worker!.on("error", () => { finish(); reject(new BackupOperationError("Export worker failed", 500)); });
      worker!.on("exit", () => { finish(); reject(new BackupOperationError("Export worker stopped", 500)); });
      if (signal?.aborted) abort();
    });
    await worker.terminate();
    worker = undefined;
    shared.nookBackupExport = current;
    const ready = current;
    ready.timer = setTimeout(() => { void dispose(ready).catch(() => console.error("Backup export cleanup failed")); }, 30 * 60_000);
    ready.timer.unref();
    return { token: ready.token, applications: counts.applications };
  } catch (error) {
    await worker?.terminate();
    if (current) await dispose(current); else release();
    if (error instanceof BackupOperationError) throw error;
    throw new BackupOperationError("Could not prepare the export", 500);
  }
}

export async function downloadBackupExport(token: string) {
  const current = shared.nookBackupExport;
  if (!current || current.token !== token || current.cleanup || current.downloading) throw new BackupOperationError("Export not found or expired", 404);
  current.downloading = true;
  clearTimeout(current.timer);
  const path = join(current.directory, "backup.json");
  try {
    const size = (await stat(path)).size;
    const iterator = createReadStream(path, { highWaterMark: 64 * 1024 })[Symbol.asyncIterator]();
    let transferred = 0;
    const arm = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      clearTimeout(current.timer);
      current.timer = setTimeout(() => {
        controller.error(new BackupOperationError("Export download stalled for 60 seconds", 408));
        return iterator.return?.().finally(() => dispose(current)).catch(() => console.error("Backup export cleanup failed"));
      }, 60_000);
      current.timer.unref();
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) { arm(controller); },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) { await dispose(current); controller.close(); }
          else {
            transferred += next.value.byteLength;
            if (transferred === size) {
              // Finish cleanup before the client receives its advertised final byte.
              await iterator.return?.();
              await dispose(current);
              controller.enqueue(next.value);
              controller.close();
            } else { arm(controller); controller.enqueue(next.value); }
          }
        } catch (error) { await dispose(current); controller.error(error); }
      },
      async cancel() { await iterator.return?.(); await dispose(current); },
    });
    return new Response(body, { headers: {
      "Content-Type": "application/json", "Content-Length": String(size), "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="nook-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { await dispose(current); throw error; }
}
