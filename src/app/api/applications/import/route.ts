import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { apiError, validationErrorResponse } from "@/lib/api";
import { BACKUP_TOO_MANY_APPLICATIONS_ERROR, MAX_BACKUP_APPLICATIONS } from "@/lib/backup-limits";
import { backupSnapshotSchema, canonicalSnapshot } from "@/lib/backup-snapshot";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const contents = parseMutationJson(checked.body);
    if (isRecord(contents) && Array.isArray(contents.applications) && contents.applications.length > MAX_BACKUP_APPLICATIONS) {
      return NextResponse.json({ error: BACKUP_TOO_MANY_APPLICATIONS_ERROR }, { status: 413 });
    }
    const parsed = backupSnapshotSchema.safeParse(contents);
    if (!parsed.success) return validationErrorResponse(parsed.error, "Unsupported or invalid Nook version 1 backup");
    const records = parsed.data.applications;
    const ids = records.map((item) => item.id);
    const eventIds = records.flatMap((item) => item.events.map((event) => event.id));
    if (new Set(ids).size !== ids.length || new Set(eventIds).size !== eventIds.length) {
      return NextResponse.json({ error: "Backup contains duplicate IDs" }, { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.application.findMany({ where: { id: { in: ids } }, include: { events: true } });
      const byId = new Map(existing.map((item) => [item.id, item]));
      const conflicts = records.filter((item) => {
        const found = byId.get(item.id);
        return found && canonicalSnapshot(found) !== canonicalSnapshot(item);
      }).map((item) => item.id);
      if (conflicts.length) return { conflicts, created: [], skippedIds: [] };
      const newRecords = records.filter((item) => !byId.has(item.id));
      const occupiedEvents = await tx.applicationEvent.findMany({ where: { id: { in: newRecords.flatMap((item) => item.events.map((event) => event.id)) } }, select: { id: true } });
      if (occupiedEvents.length) return { conflicts: occupiedEvents.map((event) => event.id), created: [], skippedIds: [] };
      const created = [];
      for (const { events, ...data } of newRecords) created.push(await tx.application.create({ data: { ...data, events: { create: events } } }));
      return { conflicts: [], created, skippedIds: existing.map((item) => item.id) };
    }, { timeout: 60_000 });
    if (result.conflicts.length) return NextResponse.json({ error: `Conflicting IDs: ${result.conflicts.join(", ")}`, conflicts: result.conflicts }, { status: 409 });
    return NextResponse.json({ applications: result.created, createdIds: result.created.map((item) => item.id), skippedIds: result.skippedIds }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Backup ID conflicts with an existing record" }, { status: 409 });
    return apiError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
