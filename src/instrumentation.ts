export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { cleanupAbandonedBackupStages } = await import("@/lib/backup-staging");
    await cleanupAbandonedBackupStages();
    const { startUndoSnapshotMaintenance } = await import("@/lib/undo-snapshots");
    await startUndoSnapshotMaintenance();
  }
}
