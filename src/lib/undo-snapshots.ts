import { prisma, serializeWrite } from "@/lib/prisma";

export const UNDO_SNAPSHOT_TTL_MS = 10 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

const maintenance = globalThis as unknown as {
  undoSnapshotCleanup?: Promise<void>;
  undoSnapshotMaintenance?: Promise<void>;
  undoSnapshotTimer?: ReturnType<typeof setInterval>;
};

export function cleanupExpiredUndoSnapshots(now?: Date): Promise<void> {
  if (maintenance.undoSnapshotCleanup) return maintenance.undoSnapshotCleanup;
  maintenance.undoSnapshotCleanup = serializeWrite(() =>
    prisma.undoSnapshot.deleteMany({ where: { expiresAt: { lte: now ?? new Date() } } }),
  ).then(() => undefined).catch(() => {
    console.warn("Expired undo snapshot cleanup failed; retrying on the next maintenance interval");
  }).finally(() => {
    maintenance.undoSnapshotCleanup = undefined;
  });
  return maintenance.undoSnapshotCleanup;
}

export function startUndoSnapshotMaintenance(): Promise<void> {
  if (maintenance.undoSnapshotMaintenance) return maintenance.undoSnapshotMaintenance;
  maintenance.undoSnapshotMaintenance = (async () => {
    await cleanupExpiredUndoSnapshots();
    maintenance.undoSnapshotTimer = setInterval(() => {
      void cleanupExpiredUndoSnapshots();
    }, CLEANUP_INTERVAL_MS);
    maintenance.undoSnapshotTimer.unref();
  })();
  return maintenance.undoSnapshotMaintenance;
}
