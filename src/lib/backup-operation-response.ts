import { BackupOperationError } from "@/lib/backup-staging";

export function backupOperationError(error: unknown) {
  const status = error instanceof BackupOperationError ? error.status : 500;
  return Response.json({ error: error instanceof BackupOperationError ? error.message : "Backup operation failed", ...(error instanceof BackupOperationError && error.conflicts && { conflicts: error.conflicts }) }, {
    status, headers: { "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "1" } : {}) },
  });
}
