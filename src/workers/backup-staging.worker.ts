import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { statfsSync } from "node:fs";
import { join } from "node:path";
import { normalizeDuplicateText, closeRoleScore } from "@/lib/duplicate-match";
import { validateBackupStream } from "@/lib/backup-stream-validator";

const port = parentPort!;
const directory = workerData.directory as string;
let receive: ((message: { id: number; type: string; bytes?: Uint8Array }) => void) | undefined;
let database: DatabaseSync | undefined;
let result: Awaited<ReturnType<typeof validateBackupStream>>;
let livePosition = 0;
let lastProgress = 0;
const progress = () => {
  if (Date.now() - lastProgress >= 1000) {
    lastProgress = Date.now();
    port.postMessage({ type: "progress" });
  }
};
async function* chunks() {
  port.postMessage({ type: "ready" });
  while (true) {
    const message = await new Promise<{ id: number; type: string; bytes?: Uint8Array }>((resolve) => { receive = resolve; });
    receive = undefined;
    if (message.type === "end") return;
    const storage = statfsSync(directory);
    if (storage.bavail * storage.bsize < 8 * 1024 * 1024) throw Object.assign(new Error("Temporary storage unavailable"), { code: "ENOSPC" });
    yield message.bytes!;
    port.postMessage({ id: message.id, value: null });
  }
}
const validation = validateBackupStream(chunks(), { directory, progress }).then((value) => {
  result = value;
  database = new DatabaseSync(join(directory, "validation.sqlite"));
  database.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA cache_size = -2048; PRAGMA temp_store = FILE;");
}).catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  const sqliteCode = (error as { errcode?: number }).errcode;
  const storage = code === "ENOSPC" || code === "SQLITE_FULL" || code?.startsWith("SQLITE_IOERR") || sqliteCode === 13 || sqliteCode === 10;
  // Do not send paths, SQL, or unbounded parser diagnostics to the caller.
  port.postMessage({ type: "failure", status: storage ? 507 : (code?.includes("SQLITE") || code === "EACCES" || code === "EIO") ? 500 : 400,
    error: storage ? "Not enough temporary storage for the backup" : "Unsupported or invalid Nook version 1 backup" });
  throw error;
});
void validation.catch(() => undefined);
port.on("message", async (message: { id: number; type: string; bytes?: Uint8Array; after?: number; owner?: number; kind?: string; cursor?: string; position?: number; rows?: Record<string, unknown>[] }) => {
  try {
    if (message.type === "chunk") { receive!(message); return; }
    if (message.type === "end") {
      receive!(message);
      await validation;
      port.postMessage({ id: message.id, value: result });
    } else if (message.type === "page") {
      const rows = database!.prepare("SELECT position, payload FROM applications WHERE position > ? ORDER BY position LIMIT 200").all(message.after ?? -1);
      port.postMessage({ id: message.id, value: rows.map((row) => ({ position: row.position, ...JSON.parse(row.payload as string) })) });
    } else if (message.type === "review-start") {
      database!.exec(`CREATE TABLE review (source INTEGER NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL, company TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(source, position)) WITHOUT ROWID;
        CREATE INDEX review_company ON review(company, source, position);
        CREATE INDEX review_id ON review(source, id);`);
      const insert = database!.prepare("INSERT INTO review VALUES (1, ?, ?, ?, ?)");
      for (const row of database!.prepare("SELECT position, payload FROM applications ORDER BY position").iterate()) {
        const record = JSON.parse(row.payload as string);
        insert.run(row.position, record.id, normalizeDuplicateText(record.company), row.payload);
        progress();
      }
      port.postMessage({ id: message.id, value: null });
    } else if (message.type === "review-add") {
      const insert = database!.prepare("INSERT INTO review VALUES (0, ?, ?, ?, ?)");
      for (const record of message.rows!) insert.run(livePosition++, record.id as string, normalizeDuplicateText(record.company as string), JSON.stringify(record));
      port.postMessage({ id: message.id, value: null });
    } else if (message.type === "duplicate") {
      const row = database!.prepare("SELECT payload FROM applications WHERE position = ?").get(message.position!);
      const candidate = row && JSON.parse(row.payload as string);
      let match: { application: Record<string, unknown>; kind: "exact" | "close"; score: number } | null = null;
      if (candidate && !database!.prepare("SELECT 1 FROM review WHERE source = 0 AND id = ?").get(candidate.id)) {
        const role = normalizeDuplicateText(candidate.role);
        let source = -1;
        let position = -1;
        while (true) {
          const page = database!.prepare(`SELECT source, position, payload FROM review WHERE company = ?
            AND (source = 0 OR (position < ? AND NOT EXISTS (SELECT 1 FROM review AS live WHERE live.source = 0 AND live.id = review.id)))
            AND (source > ? OR (source = ? AND position > ?)) ORDER BY source, position LIMIT 200`).all(normalizeDuplicateText(candidate.company), message.position!, source, source, position);
          if (!page.length) break;
          for (const item of page) {
            const application = JSON.parse(item.payload as string);
            const other = normalizeDuplicateText(application.role);
            const score = other === role ? 2 : closeRoleScore(role, other);
            if (score !== null && (!match || score > match.score)) match = { application: { ...application, revision: application.revision ?? 0, interviews: [] }, kind: other === role ? "exact" : "close", score };
            progress();
          }
          source = page.at(-1)!.source as number;
          position = page.at(-1)!.position as number;
        }
      }
      port.postMessage({ id: message.id, value: match ? { application: match.application, kind: match.kind } : null });
    } else if (message.type === "children") {
      const rows = database!.prepare("SELECT payload FROM children WHERE kind = ? AND owner = ? AND json_extract(payload, '$.id') > ? ORDER BY json_extract(payload, '$.id') LIMIT 200").all(message.kind!, message.owner!, message.cursor ?? "");
      port.postMessage({ id: message.id, value: rows.map((row) => JSON.parse(row.payload as string)) });
    }
  } catch {
    port.postMessage({ id: message.id, error: "Backup staging worker failed", status: 500 });
  }
});
