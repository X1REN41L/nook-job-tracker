import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError, parseRequest } from "@/lib/api";
import { applicationInclude, applicationSnapshotInclude } from "@/lib/application-record";
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
    const { applications: targets } = parseRequest(bulkDeleteRequestSchema, parseMutationJson(checked.body));
    await cleanupExpiredUndoSnapshots();
    const revisions = new Map(targets.map(({ id, revision }) => [id, revision]));
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + UNDO_SNAPSHOT_TTL_MS);
    const result = await serializeWrite(() => prisma.$transaction(async (transaction) => {
      const applications = await transaction.application.findMany({ where: { id: { in: targets.map(({ id }) => id) } }, include: { ...applicationSnapshotInclude, events: true } });
      const conflicts = applications.filter(({ id, revision }) => revision !== revisions.get(id));
      if (conflicts.length) return { conflicts, deletedIds: [] };
      if (!applications.length) return { conflicts: [], deletedIds: [] };
      await transaction.undoSnapshot.createMany({
        data: applications.map((application) => ({ token: bulkSnapshotToken(token, application.id), applicationId: application.id, payload: JSON.stringify(application), expiresAt })),
      });
      // Keep SQL expression depth bounded even at the 1,000-target request limit.
      for (let offset = 0; offset < applications.length; offset += 100) {
        const batch = applications.slice(offset, offset + 100);
        const deleted = await transaction.application.deleteMany({ where: { OR: batch.map(({ id, revision }) => ({ id, revision })) } });
        if (deleted.count !== batch.length) throw new Error("Bulk deletion changed during transaction");
      }
      return { conflicts: [], deletedIds: applications.map(({ id }) => id) };
    }));
    if (result.conflicts.length) return NextResponse.json({
      error: "Applications changed since confirmation. Review the current versions and confirm deletion again. Nothing was deleted.",
      applications: await prisma.application.findMany({ where: { id: { in: result.conflicts.slice(0, 200).map(({ id }) => id) } }, include: applicationInclude, take: 200 }),
      conflictIds: result.conflicts.map(({ id }) => id),
    }, { status: 409 });
    return NextResponse.json({ token, expiresAt: expiresAt.toISOString(), deletedIds: result.deletedIds });
  } catch (error) {
    return apiError(error, "applications/bulk-delete");
  }
}
