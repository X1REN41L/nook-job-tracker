import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError, parseRequest } from "@/lib/api";
import { bulkDeleteRequestSchema, bulkSnapshotToken } from "@/lib/bulk-delete";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots, UNDO_SNAPSHOT_TTL_MS } from "@/lib/undo-snapshots";

/**
 * Deletes several applications in one transaction, keeping an undo snapshot of each: all of them are deleted, or
 * none are. IDs that are already gone count as done, since the outcome the caller wants already holds.
 */
export async function POST(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    await cleanupExpiredUndoSnapshots();
    const { ids } = parseRequest(bulkDeleteRequestSchema, parseMutationJson(checked.body));
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + UNDO_SNAPSHOT_TTL_MS);
    const deletedIds = await serializeWrite(() => prisma.$transaction(async (transaction) => {
      const applications = await transaction.application.findMany({ where: { id: { in: ids } }, include: { events: true, interviews: true, contacts: true } });
      if (!applications.length) return [];
      await transaction.undoSnapshot.createMany({
        data: applications.map((application) => ({ token: bulkSnapshotToken(token, application.id), applicationId: application.id, payload: JSON.stringify(application), expiresAt })),
      });
      await transaction.application.deleteMany({ where: { id: { in: applications.map(({ id }) => id) } } });
      return applications.map(({ id }) => id);
    }));
    return NextResponse.json({ token, expiresAt: expiresAt.toISOString(), deletedIds });
  } catch (error) {
    return apiError(error);
  }
}
