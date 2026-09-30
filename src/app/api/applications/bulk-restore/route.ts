import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { apiError, parseRequest } from "@/lib/api";
import { applicationInclude } from "@/lib/application-record";
import { applicationRestoreSnapshotSchema, storedChildren } from "@/lib/backup-snapshot";
import { bulkRestoreRequestSchema, bulkSnapshotToken } from "@/lib/bulk-delete";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots } from "@/lib/undo-snapshots";

/** Restores a bulk delete in one transaction: every application in the batch comes back, or none do. */
export async function POST(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    await cleanupExpiredUndoSnapshots();
    const { token, ids } = parseRequest(bulkRestoreRequestSchema, parseMutationJson(checked.body));
    const tokens = ids.map((id) => bulkSnapshotToken(token, id));
    const result = await serializeWrite(() => prisma.$transaction(async (tx) => {
      const held = await tx.undoSnapshot.findMany({ where: { token: { in: tokens }, expiresAt: { gt: new Date() } } });
      if (held.length !== ids.length) return { status: 404 as const };
      if (await tx.application.count({ where: { id: { in: ids } } })) return { status: 409 as const };
      const applications = [];
      for (const snapshot of held) {
        const stored = JSON.parse(snapshot.payload);
        const { events, interviews, contacts, ...data } = applicationRestoreSnapshotSchema.parse({ ...stored, ...storedChildren(stored) });
        applications.push(await tx.application.create({
          data: { ...data, events: { create: events }, interviews: { create: interviews }, contacts: { create: contacts } },
          include: applicationInclude,
        }));
      }
      await tx.undoSnapshot.deleteMany({ where: { token: { in: tokens } } });
      return { status: 201 as const, applications };
    }));
    if (result.status === 404) return NextResponse.json({ error: "Restore expired or already used" }, { status: 404 });
    if (result.status === 409) return NextResponse.json({ error: "An application with one of these IDs already exists" }, { status: 409 });
    return NextResponse.json({ applications: result.applications }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Application or event ID already exists" }, { status: 409 });
    return apiError(error);
  }
}
