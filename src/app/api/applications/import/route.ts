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
    const prepared = records.map(({ events, ...application }) => ({
      application,
      events: events.map((event) => ({ ...event, applicationId: application.id })),
    }));
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.application.findMany({ where: { id: { in: ids } }, include: { events: true } });
      const byId = new Map(existing.map((item) => [item.id, item]));
      const conflicts = records.filter((item) => {
        const found = byId.get(item.id);
        return found && canonicalSnapshot(found) !== canonicalSnapshot(item);
      });
      if (conflicts.length) return { conflicts: conflicts.map((item) => item.id), conflictNames: conflicts.map((item) => {
        const existing = byId.get(item.id)!;
        return `${existing.company} — ${existing.role}`;
      }), created: [], skippedIds: [] };
      const newRecords = prepared.filter(({ application }) => !byId.has(application.id));
      const occupiedEvents = await tx.applicationEvent.findMany({ where: { id: { in: newRecords.flatMap(({ events }) => events.map((event) => event.id)) } }, select: { id: true } });
      if (occupiedEvents.length) return { conflicts: occupiedEvents.map((event) => event.id), conflictNames: [], created: [], skippedIds: [] };
      if (newRecords.length) {
        await tx.application.createMany({ data: newRecords.map(({ application }) => application) });
        const events = newRecords.flatMap((item) => item.events);
        if (events.length) await tx.applicationEvent.createMany({ data: events });
      }
      const row = await tx.settings.upsert({
        where: { id: 1 },
        create: { id: 1, value: JSON.stringify(parsed.data.settings), revision: 1 },
        update: { value: JSON.stringify(parsed.data.settings), revision: { increment: 1 } },
      });
      const inserted = await tx.application.findMany({ where: { id: { in: newRecords.map(({ application }) => application.id) } } });
      const insertedById = new Map(inserted.map((application) => [application.id, application]));
      const created = newRecords.map(({ application }) => insertedById.get(application.id)!);
      return { conflicts: [], conflictNames: [], created, skippedIds: existing.map((item) => item.id), settings: parsed.data.settings, settingsRevision: row.revision };
    }, { timeout: 60_000 });
    if (result.conflicts.length) return NextResponse.json({ error: result.conflictNames.length
      ? `Import stopped: ${result.conflictNames.slice(0, 3).join(", ")}${result.conflictNames.length > 3 ? ` and ${result.conflictNames.length - 3} more` : ""} changed since this backup. No applications or settings were imported.`
      : `Import stopped: an event ID already exists (${result.conflicts[0]}). No applications or settings were imported.`, conflicts: result.conflicts }, { status: 409 });
    return NextResponse.json({ applications: result.created, createdIds: result.created.map((item) => item.id), skippedIds: result.skippedIds, settings: result.settings, settingsRevision: result.settingsRevision }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Backup ID conflicts with an existing record" }, { status: 409 });
    return apiError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
