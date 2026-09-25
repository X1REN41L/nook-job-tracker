import { prisma } from "@/lib/prisma";

export async function cleanupExpiredUndoSnapshots(now = new Date()) {
  await prisma.undoSnapshot.deleteMany({
    where: { expiresAt: { lte: now } },
  });
}
