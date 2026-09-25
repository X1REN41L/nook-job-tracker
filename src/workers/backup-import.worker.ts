import { backupSnapshotSchema, type BackupSnapshot } from "@/lib/backup-snapshot";
import { BACKUP_TOO_MANY_APPLICATIONS_ERROR, MAX_BACKUP_APPLICATIONS } from "@/lib/backup-limits";

type WorkerResponse =
  | { ok: true; backup: BackupSnapshot }
  | { ok: false; error: string };

self.addEventListener("message", (event: MessageEvent<File>) => {
  void validateBackupFile(event.data);
});

async function validateBackupFile(file: File) {
  let contents: unknown;
  try {
    contents = JSON.parse(await file.text());
  } catch {
    post({ ok: false, error: "Choose a valid JSON backup file." });
    return;
  }

  if (isRecord(contents) && Array.isArray(contents.applications) && contents.applications.length > MAX_BACKUP_APPLICATIONS) {
    post({ ok: false, error: BACKUP_TOO_MANY_APPLICATIONS_ERROR });
    return;
  }

  if (!backupSnapshotSchema.safeParse(contents).success) {
    post({ ok: false, error: "Unsupported or invalid Nook version 2 backup." });
    return;
  }

  post({ ok: true, backup: contents as BackupSnapshot });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function post(response: WorkerResponse) {
  self.postMessage(response);
}
