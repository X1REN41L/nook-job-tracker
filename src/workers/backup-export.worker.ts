import { parentPort, workerData } from "node:worker_threads";
import { backup, DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { open, statfs } from "node:fs/promises";
import { join } from "node:path";
import { validateBackupStream } from "@/lib/backup-stream-validator";
import { defaultSettings } from "@/lib/settings-defaults";
import { rawEventSnapshotSchema } from "@/lib/backup-snapshot";

const directory = workerData.directory as string;
const port = parentPort!;
const tables = { events: "ApplicationEvent", interviews: "Interview", contacts: "Contact" };
function record(row: Record<string, unknown>) {
  const result = { ...row };
  delete result.applicationId;
  delete result.revision;
  for (const key of ["createdAt", "lastUpdated", "appliedDate", "followUpDate", "date"]) {
    const value = result[key];
    if (value !== undefined && value !== null) {
      result[key] = (typeof value === "string" ? rawEventSnapshotSchema.shape.createdAt.parse(value) : new Date(value as number)).toISOString();
    }
  }
  for (const key of ["archived", "interviewDatePromptDismissed"]) {
    if (result[key] === 0 || result[key] === 1) result[key] = result[key] === 1;
  }
  return result;
}

async function prepare() {
  const source = new DatabaseSync(workerData.database, { readOnly: true });
  const snapshotPath = join(directory, "snapshot.sqlite");
  // Precreate private files; the backup API overwrites this empty destination.
  await (await open(snapshotPath, "wx", 0o600)).close();
  try {
    source.exec("BEGIN");
    source.prepare("SELECT count(*) FROM sqlite_schema").get();
    await backup(source, snapshotPath, { rate: 200 });
  } finally { source.close(); }
  port.postMessage({ type: "snapshot" });
  const snapshot = new DatabaseSync(snapshotPath);
  const file = await open(join(directory, "backup.json"), "wx", 0o600);
  let lastStorageCheck = 0;
  async function write(value: string) {
    if (Date.now() - lastStorageCheck > 1000) {
      const storage = await statfs(directory);
      if (storage.bavail * storage.bsize < 8 * 1024 * 1024) throw Object.assign(new Error(), { code: "ENOSPC" });
      lastStorageCheck = Date.now();
    }
    // FileHandle.write can be partial, so use writeFile at the current position.
    await file.writeFile(value);
  }
  try {
    snapshot.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA cache_size = -2048; PRAGMA temp_store = FILE;");
    for (const table of Object.values(tables)) snapshot.exec(`CREATE INDEX export_${table}_page ON ${table}(applicationId, id)`);
    const settings = snapshot.prepare("SELECT value FROM Settings WHERE id = 1").get();
    // Preserve persisted JSON syntax so the shared validator also rejects duplicate keys.
    await write(`{"version":1,"settings":${settings ? settings.value : JSON.stringify(defaultSettings)},"applications":[`);
    let cursor = "";
    let first = true;
    while (true) {
      const page = snapshot.prepare("SELECT * FROM Application WHERE id > ? ORDER BY id LIMIT 200").all(cursor);
      if (!page.length) break;
      for (const row of page) {
        await write(`${first ? "" : ","}${JSON.stringify(record(row)).slice(0, -1)}`);
        first = false;
        for (const [kind, table] of Object.entries(tables)) {
          await write(`,"${kind}":[`);
          let childCursor = "";
          let firstChild = true;
          while (true) {
            const children = snapshot.prepare(`SELECT * FROM ${table} WHERE applicationId = ? AND id > ? ORDER BY id LIMIT 200`).all(row.id, childCursor);
            if (!children.length) break;
            for (const child of children) {
              await write(`${firstChild ? "" : ","}${JSON.stringify(record(child))}`);
              firstChild = false;
            }
            childCursor = children.at(-1)!.id as string;
          }
          await write("]");
        }
        await write("}");
      }
      cursor = page.at(-1)!.id as string;
    }
    await write("]}");
  } finally { await file.close(); snapshot.close(); }
  const counts = await validateBackupStream(createReadStream(join(directory, "backup.json")), { directory });
  const check = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    if (check.prepare("SELECT count(*) AS count FROM Application").get()!.count !== counts.applications) throw new Error("Invalid application IDs");
    for (const [kind, table] of Object.entries(tables)) {
      if (check.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count !== counts[kind as keyof typeof tables]) throw new Error("Orphan records");
    }
  } finally { check.close(); }
  return counts;
}
void prepare().then((counts) => { port.postMessage({ counts }); }).catch((error) => {
  const storage = error.code === "ENOSPC" || error.errcode === 13 || error.errcode === 10;
  port.postMessage({ status: storage ? 507 : 500, error: storage ? "Not enough temporary storage for the export" : "Could not export: stored data is invalid or the database could not be read" });
});
