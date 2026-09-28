import { prisma } from "@/lib/prisma";

export async function cleanupExpiredUndoSnapshots(now = new Date()) {
  try {
    await prisma.undoSnapshot.deleteMany({ where: { expiresAt: { lte: now } } });
  } catch (error) {
    console.warn("Expired undo snapshot cleanup failed", error);
  }
}
