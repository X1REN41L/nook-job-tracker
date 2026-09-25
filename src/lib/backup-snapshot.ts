import { EventType, Status } from "@prisma/client";
import { z } from "zod";

import { MAX_BACKUP_APPLICATIONS } from "@/lib/backup-limits";
import { settingsSchema } from "@/lib/backup-settings-schema";

const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
export const eventSnapshotSchema = z.object({
  id: z.string().min(1), type: z.enum(EventType), detail: z.string().nullable(),
  emailSnippet: z.string().nullable(), createdAt: date,
}).strict();
export const applicationSnapshotSchema = z.object({
  id: z.string().min(1), company: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(120),
  status: z.enum(Status), archived: z.boolean().default(false), source: z.string().max(120).nullable(), appliedDate: date,
  interviewDate: date.nullable(), interviewDatePromptDismissed: z.boolean(),
  notes: z.string().max(5000).nullable(), jobUrl: z.string().max(2000).nullable(),
  createdAt: date, lastUpdated: date, events: z.array(eventSnapshotSchema),
}).strict();
export const applicationRestoreSnapshotSchema = applicationSnapshotSchema.extend({
  revision: z.number().int().nonnegative().default(0),
});
export const backupSnapshotSchema = z.object({
  version: z.literal(2), applications: z.array(applicationSnapshotSchema).max(MAX_BACKUP_APPLICATIONS), settings: settingsSchema,
}).strict();
export type BackupSnapshot = z.input<typeof backupSnapshotSchema>;

export function canonicalSnapshot(value: unknown) {
  const input = value as Record<string, unknown> & { events: Array<{ id: string; type: EventType; detail: string | null; emailSnippet: string | null; createdAt: string | Date }> };
  const { revision, ...snapshotInput } = input;
  void revision;
  const asString = (date: unknown) => date instanceof Date ? date.toISOString() : date;
  const record = applicationSnapshotSchema.parse({
    ...snapshotInput,
    appliedDate: asString(snapshotInput.appliedDate),
    interviewDate: asString(snapshotInput.interviewDate),
    createdAt: asString(snapshotInput.createdAt),
    lastUpdated: asString(snapshotInput.lastUpdated),
    events: snapshotInput.events.map((event) => ({ id: event.id, type: event.type, detail: event.detail, emailSnippet: event.emailSnippet, createdAt: asString(event.createdAt) })),
  });
  return JSON.stringify({ ...record, events: [...record.events].sort((a, b) => a.id.localeCompare(b.id)) });
}
