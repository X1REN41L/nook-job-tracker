import { prisma } from "@/lib/prisma";

export const UNDO_SNAPSHOT_TTL_MS = 10 * 60_000;

export async function cleanupExpiredUndoSnapshots(now = new Date()) {
  try {
    await prisma.undoSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
  } catch (error) {
    console.warn("Expired undo snapshot cleanup failed", error);
  }
}
