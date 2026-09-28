import { EventType, Status } from "@prisma/client";
import { z } from "zod";

import {
  applicationIdSchema, eventTextSchema, recordIdSchema, storedCalendarDateSchema, storedJobUrlSchema,
  storedOptionalText, storedRequiredText,
} from "@/lib/application-schema";
import { MAX_BACKUP_APPLICATIONS } from "@/lib/backup-limits";
import { settingsSchema } from "@/lib/backup-settings-schema";
import { isValidStatusTransition, statusTransitionDetail } from "@/lib/status-history";

type TypedTransition = { fromStatus: Status; toStatus: Status };

function possibleTrailEnds(edges: TypedTransition[], starts: Status[]) {
  if (!edges.length) return new Set(starts);
  const outgoing = new Map<Status, number>();
  const incoming = new Map<Status, number>();
  const neighbors = new Map<Status, Set<Status>>();
  for (const { fromStatus, toStatus } of edges) {
    outgoing.set(fromStatus, (outgoing.get(fromStatus) ?? 0) + 1);
    incoming.set(toStatus, (incoming.get(toStatus) ?? 0) + 1);
    neighbors.set(fromStatus, (neighbors.get(fromStatus) ?? new Set()).add(toStatus));
    neighbors.set(toStatus, (neighbors.get(toStatus) ?? new Set()).add(fromStatus));
  }
  const connected = new Set<Status>();
  const pending = [edges[0].fromStatus];
  while (pending.length) {
    const status = pending.pop()!;
    if (connected.has(status)) continue;
    connected.add(status);
    pending.push(...(neighbors.get(status) ?? []));
  }
  if (connected.size !== neighbors.size) return new Set<Status>();

  const vertices = [...neighbors.keys()];
  const differences = vertices.map((status) => (outgoing.get(status) ?? 0) - (incoming.get(status) ?? 0));
  const positive = vertices.filter((status) => (outgoing.get(status) ?? 0) - (incoming.get(status) ?? 0) === 1);
  const negative = vertices.filter((status) => (incoming.get(status) ?? 0) - (outgoing.get(status) ?? 0) === 1);
  const balanced = differences.every((difference) => difference === 0);
  if (!balanced && !(positive.length === 1 && negative.length === 1 && differences.every((difference) => Math.abs(difference) <= 1))) {
    return new Set<Status>();
  }

  const allowedStarts = balanced ? vertices : positive;
  const ends = new Set<Status>();
  for (const start of starts) {
    if (!allowedStarts.includes(start)) continue;
    ends.add(balanced ? start : negative[0]);
  }
  return ends;
}

// Real timestamps keep accepting any offset; calendar dates must be the UTC-midnight form Nook exports.
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const rawEventSnapshotSchema = z.object({
  id: recordIdSchema, type: z.enum(EventType), detail: eventTextSchema,
  fromStatus: z.enum(Status).nullable(), toStatus: z.enum(Status).nullable(),
  emailSnippet: eventTextSchema, createdAt: timestamp,
}).strict();
export const eventSnapshotSchema = rawEventSnapshotSchema.transform((event, context) => {
  if (event.type !== EventType.STATUS_CHANGE) {
    if (event.fromStatus !== null || event.toStatus !== null) {
      context.addIssue({ code: "custom", message: "Only status change events can include status fields" });
      return z.NEVER;
    }
    return event;
  }

  if (event.fromStatus !== null && event.toStatus !== null) {
    if (!isValidStatusTransition(event.fromStatus, event.toStatus)) {
      context.addIssue({ code: "custom", message: "Status change must move to a different status" });
      return z.NEVER;
    }
    if (event.detail !== statusTransitionDetail(event.fromStatus, event.toStatus)) {
      context.addIssue({ code: "custom", message: "Typed status fields must match the event detail" });
      return z.NEVER;
    }
    return event;
  }

  if (event.fromStatus === null && event.toStatus !== null) {
    if (event.detail !== statusTransitionDetail(null, event.toStatus)) {
      context.addIssue({ code: "custom", message: "Initial status fields must match the event detail" });
      return z.NEVER;
    }
    return event;
  }

  if (event.fromStatus !== null || event.toStatus !== null) {
    context.addIssue({ code: "custom", message: "Status fields must describe a valid transition" });
    return z.NEVER;
  }

  return event;
});
export const applicationSnapshotSchema = z.object({
  id: applicationIdSchema, company: storedRequiredText(120), role: storedRequiredText(120),
  status: z.enum(Status), archived: z.boolean(), source: storedOptionalText(120), appliedDate: storedCalendarDateSchema,
  interviewDate: storedCalendarDateSchema.nullable(), interviewDatePromptDismissed: z.boolean(),
  notes: storedOptionalText(5_000), jobUrl: storedJobUrlSchema,
  createdAt: timestamp, lastUpdated: timestamp, events: z.array(eventSnapshotSchema),
}).strict().superRefine((application, context) => {
  const statusEvents = application.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === EventType.STATUS_CHANGE)
    .sort((left, right) => {
      const timeOrder = left.event.createdAt.getTime() - right.event.createdAt.getTime();
      return timeOrder || left.event.id.localeCompare(right.event.id);
    });
  const initialEvents = statusEvents.filter(({ event }) => event.fromStatus === null && event.toStatus != null);
  if (initialEvents.length > 1) {
    context.addIssue({ code: "custom", path: ["events"], message: "History can contain only one initial status event" });
  }
  if (initialEvents.length === 1 && initialEvents[0].event.createdAt.getTime() !== statusEvents[0]?.event.createdAt.getTime()) {
    context.addIssue({ code: "custom", path: ["events", initialEvents[0].index, "fromStatus"], message: "An initial status event must be first" });
  }

  const timestampGroups: Array<typeof statusEvents> = [];
  for (const entry of statusEvents) {
    const lastGroup = timestampGroups.at(-1);
    if (lastGroup?.[0].event.createdAt.getTime() === entry.event.createdAt.getTime()) lastGroup.push(entry);
    else timestampGroups.push([entry]);
  }

  let possiblePreviousStatuses: Set<Status> | null = null;
  let completeHistory = initialEvents.length === 1;
  for (const group of timestampGroups) {
    const groupHasUnknownTransition = group.some(({ event }) => event.toStatus === null);
    const initial = group.find(({ event }) => event.fromStatus === null && event.toStatus != null);
    const typedEdges = group.flatMap(({ event }) =>
      event.fromStatus != null && event.toStatus != null
        ? [{ fromStatus: event.fromStatus, toStatus: event.toStatus }]
        : [],
    );

    if (groupHasUnknownTransition) {
      completeHistory = false;
      possiblePreviousStatuses = null;
      continue;
    }

    const starts = initial
      ? [initial.event.toStatus!]
      : possiblePreviousStatuses
        ? [...possiblePreviousStatuses]
        : Object.values(Status);
    const ends = possibleTrailEnds(typedEdges, starts);
    if (!ends.size && typedEdges.length) {
      context.addIssue({
        code: "custom",
        path: ["events", group[0].index, "fromStatus"],
        message: "Status transitions must form a consistent sequence",
      });
      possiblePreviousStatuses = null;
      completeHistory = false;
      continue;
    }
    possiblePreviousStatuses = ends;
  }
  if (completeHistory && possiblePreviousStatuses && !possiblePreviousStatuses.has(application.status)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Saved status must match the final status in history" });
  }
});
// Undo restore and the import duplicate comparison read rows this server stored itself, so they check
// field types only. They must not reuse the import rules above: rows stored under older rules would
// otherwise be lost on undo, or turn an import conflict into a validation error.
const storedTimestamp = z.iso.datetime().transform((value) => new Date(value));
const storedEventSchema = z.object({
  id: z.string().min(1), type: z.enum(EventType), detail: z.string().nullable(),
  fromStatus: z.enum(Status).nullable(), toStatus: z.enum(Status).nullable(),
  emailSnippet: z.string().nullable(), createdAt: storedTimestamp,
}).strict();
export const applicationRestoreSnapshotSchema = z.object({
  id: z.string().min(1), company: z.string(), role: z.string(), status: z.enum(Status), archived: z.boolean(),
  revision: z.number().int().nonnegative(), source: z.string().nullable(), appliedDate: storedTimestamp,
  interviewDate: storedTimestamp.nullable(), interviewDatePromptDismissed: z.boolean(),
  notes: z.string().nullable(), jobUrl: z.string().nullable(), createdAt: storedTimestamp, lastUpdated: storedTimestamp,
  events: z.array(storedEventSchema),
}).strict();
const storedComparisonSchema = applicationRestoreSnapshotSchema.omit({ revision: true });
export const backupSnapshotSchema = z.object({
  version: z.literal(1), applications: z.array(applicationSnapshotSchema).max(MAX_BACKUP_APPLICATIONS), settings: settingsSchema,
}).strict().superRefine((backup, context) => {
  const now = Date.now();
  backup.applications.forEach((application, applicationIndex) => application.events.forEach((event, eventIndex) => {
    if (event.createdAt.getTime() > now) {
      context.addIssue({ code: "custom", path: ["applications", applicationIndex, "events", eventIndex, "createdAt"], message: "Event time must not be in the future" });
    }
  }));
});
export type BackupSnapshot = z.input<typeof backupSnapshotSchema>;

export function canonicalSnapshot(value: unknown) {
  const input = value as Record<string, unknown> & { events: Array<{
    id: string; type: EventType; detail: string | null; fromStatus?: Status | null; toStatus?: Status | null;
    emailSnippet: string | null; createdAt: string | Date;
  }> };
  const { revision, ...snapshotInput } = input;
  void revision;
  const asString = (date: unknown) => date instanceof Date ? date.toISOString() : date;
  const record = storedComparisonSchema.parse({
    ...snapshotInput,
    appliedDate: asString(snapshotInput.appliedDate),
    interviewDate: asString(snapshotInput.interviewDate),
    createdAt: asString(snapshotInput.createdAt),
    lastUpdated: asString(snapshotInput.lastUpdated),
    events: snapshotInput.events.map((event) => ({
      id: event.id, type: event.type, detail: event.detail, fromStatus: event.fromStatus, toStatus: event.toStatus,
      emailSnippet: event.emailSnippet, createdAt: asString(event.createdAt),
    })),
  });
  return JSON.stringify({ ...record, events: [...record.events].sort((a, b) => a.id.localeCompare(b.id)) });
}
