export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { warnIfDatabaseMissing } = await import("@/lib/database-check");
    await warnIfDatabaseMissing();
    const { cleanupAbandonedBackupStages } = await import("@/lib/backup-staging");
    await cleanupAbandonedBackupStages();
    const { startUndoSnapshotMaintenance } = await import("@/lib/undo-snapshots");
    await startUndoSnapshotMaintenance();
  }
}
