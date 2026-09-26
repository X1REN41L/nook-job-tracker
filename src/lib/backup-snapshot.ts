import { EventType, Status } from "@prisma/client";
import { z } from "zod";

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

const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const rawEventSnapshotSchema = z.object({
  id: z.string().min(1), type: z.enum(EventType), detail: z.string().nullable(),
  fromStatus: z.enum(Status).nullable(), toStatus: z.enum(Status).nullable(),
  emailSnippet: z.string().nullable(), createdAt: date,
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
  id: z.string().min(1), company: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(120),
  status: z.enum(Status), archived: z.boolean(), source: z.string().max(120).nullable(), appliedDate: date,
  interviewDate: date.nullable(), interviewDatePromptDismissed: z.boolean(),
  notes: z.string().max(5000).nullable(), jobUrl: z.string().max(2000).nullable(),
  createdAt: date, lastUpdated: date, events: z.array(eventSnapshotSchema),
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
  for (const group of timestampGroups) {
    const groupHasUnknownTransition = group.some(({ event }) => event.toStatus === null);
    const initial = group.find(({ event }) => event.fromStatus === null && event.toStatus != null);
    const typedEdges = group.flatMap(({ event }) =>
      event.fromStatus != null && event.toStatus != null
        ? [{ fromStatus: event.fromStatus, toStatus: event.toStatus }]
        : [],
    );

    if (groupHasUnknownTransition) {
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
      continue;
    }
    possiblePreviousStatuses = ends;
  }
});
export const applicationRestoreSnapshotSchema = applicationSnapshotSchema.extend({
  revision: z.number().int().nonnegative().default(0),
});
export const backupSnapshotSchema = z.object({
  version: z.literal(1), applications: z.array(applicationSnapshotSchema).max(MAX_BACKUP_APPLICATIONS), settings: settingsSchema,
}).strict();
export type BackupSnapshot = z.input<typeof backupSnapshotSchema>;

export function canonicalSnapshot(value: unknown) {
  const input = value as Record<string, unknown> & { events: Array<{
    id: string; type: EventType; detail: string | null; fromStatus?: Status | null; toStatus?: Status | null;
    emailSnippet: string | null; createdAt: string | Date;
  }> };
  const { revision, ...snapshotInput } = input;
  void revision;
  const asString = (date: unknown) => date instanceof Date ? date.toISOString() : date;
  const record = applicationSnapshotSchema.parse({
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
