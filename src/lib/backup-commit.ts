import type { Prisma } from "@prisma/client";
import { applicationFieldsSchema, contactSnapshotSchema, eventSnapshotSchema, interviewSnapshotSchema } from "@/lib/backup-snapshot";
import { BackupOperationError, type StagedReader } from "@/lib/backup-staging";
import { prisma, serializeWrite } from "@/lib/prisma";

const kinds = ["events", "interviews", "contacts"] as const;
type Kind = typeof kinds[number];
const comparable = (value: unknown) => value instanceof Date ? value.toISOString() : value;
function sameFields(staged: Record<string, unknown>, live: object) {
  const stored = live as Record<string, unknown>;
  return Object.entries(staged).every(([key, value]) => comparable(value) === comparable(stored[key]));
}
function conflict(id: string, name?: string) {
  return new BackupOperationError(`Import stopped: ${name ? `${name} changed since this backup` : "an event, interview, or contact ID already exists"}. No applications or settings were imported.`, 409, [id]);
}
async function liveChildren(tx: Prisma.TransactionClient, kind: Kind, applicationId: string, cursor: string) {
  const query = { where: { applicationId, id: { gt: cursor } }, orderBy: { id: "asc" as const }, take: 200 };
  if (kind === "events") return tx.applicationEvent.findMany(query);
  if (kind === "interviews") return tx.interview.findMany(query);
  return tx.contact.findMany(query);
}
async function checkChildren(tx: Prisma.TransactionClient, reader: StagedReader, kind: Kind, owner: number, applicationId: string, existing: boolean) {
  let cursor = "";
  while (true) {
    const staged = await reader.children(kind, owner, cursor);
    if (existing) {
      const live = await liveChildren(tx, kind, applicationId, cursor);
      if (staged.length !== live.length || staged.some((child, index) => !sameFields(child, live[index]))) throw conflict(applicationId);
    } else if (staged.length) {
      const query = { where: { id: { in: staged.map((child) => child.id as string) } }, select: { id: true } };
      const occupied = kind === "events" ? await tx.applicationEvent.findFirst(query)
        : kind === "interviews" ? await tx.interview.findFirst(query) : await tx.contact.findFirst(query);
      if (occupied) throw conflict(occupied.id);
    }
    if (!staged.length) break;
    cursor = staged.at(-1)!.id as string;
  }
}
async function insertChildren(tx: Prisma.TransactionClient, reader: StagedReader, kind: Kind, owner: number, applicationId: string) {
  let cursor = "";
  while (true) {
    const rows = await reader.children(kind, owner, cursor);
    if (!rows.length) return;
    if (kind === "events") await tx.applicationEvent.createMany({ data: rows.map((row) => ({ ...eventSnapshotSchema.parse(row), applicationId })) });
    else if (kind === "interviews") await tx.interview.createMany({ data: rows.map((row) => ({ ...interviewSnapshotSchema.parse(row), applicationId })) });
    else await tx.contact.createMany({ data: rows.map((row) => ({ ...contactSnapshotSchema.parse(row), applicationId })) });
    cursor = rows.at(-1)!.id as string;
  }
}

export async function commitStagedBackup(reader: StagedReader, signal?: AbortSignal) {
  const workload = reader.counts.applications + reader.counts.events + reader.counts.interviews + reader.counts.contacts;
  // Includes repeated bounded comparisons and inserts; no fixed import-size deadline.
  const timeout = Math.min(Number.MAX_SAFE_INTEGER, 60_000 + workload * 100);
  return serializeWrite(() => {
    if (signal?.aborted) throw new BackupOperationError("Backup cancelled before commit", 409);
    return prisma.$transaction(async (tx) => {
      let created = 0;
      let skipped = 0;
      let after = -1;
      while (true) {
        const page = await reader.applications(after);
        if (!page.length) break;
        const existing = await tx.application.findMany({ where: { id: { in: page.map((record) => record.id) } } });
        const byId = new Map(existing.map((record) => [record.id, record]));
        const additions = [];
        for (const record of page) {
          const { position, ...fields } = record;
          const live = byId.get(record.id);
          if (live && !sameFields(fields, live)) throw conflict(record.id, `${live.company} — ${live.role}`);
          for (const kind of kinds) await checkChildren(tx, reader, kind, position, record.id, Boolean(live));
          if (live) skipped++;
          else additions.push(record);
        }
        if (additions.length) {
          await tx.application.createMany({ data: additions.map(({ position, ...fields }) => { void position; return applicationFieldsSchema.parse(fields); }) });
          await tx.undoSnapshot.deleteMany({ where: { applicationId: { in: additions.map(({ id }) => id) } } });
          for (const record of additions) for (const kind of kinds) await insertChildren(tx, reader, kind, record.position, record.id);
          created += additions.length;
        }
        after = page.at(-1)!.position;
      }
      const row = await tx.settings.upsert({ where: { id: 1 },
        create: { id: 1, value: JSON.stringify(reader.counts.settings), revision: 1 },
        update: { value: JSON.stringify(reader.counts.settings), revision: { increment: 1 } },
      });
      return { created, skipped, settings: reader.counts.settings, settingsRevision: row.revision };
    }, { timeout });
  });
}
