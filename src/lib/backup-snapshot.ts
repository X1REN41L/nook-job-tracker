import { EventType, InterviewType, Status } from "@prisma/client";
import { z } from "zod";

import {
  applicationIdSchema, eventTextSchema, recordIdSchema, storedCalendarDateSchema, storedHttpUrlSchema, storedJobUrlSchema,
  storedOptionalText, storedRequiredText, storedTimeSchema,
} from "@/lib/application-schema";
import { settingsSchema } from "@/lib/backup-settings-schema";
import { parseFollowUpEventDetail } from "@/lib/follow-up-event";
import { isValidStatusTransition, statusTransitionDetail } from "@/lib/status-history";

type TypedTransition = { fromStatus: Status; toStatus: Status; count: number };

function possibleTrailEnds(edges: TypedTransition[], starts: Status[]) {
  if (!edges.length) return new Set(starts);
  const outgoing = new Map<Status, number>();
  const incoming = new Map<Status, number>();
  const neighbors = new Map<Status, Set<Status>>();
  for (const { fromStatus, toStatus, count } of edges) {
    outgoing.set(fromStatus, (outgoing.get(fromStatus) ?? 0) + count);
    incoming.set(toStatus, (incoming.get(toStatus) ?? 0) + count);
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
export const rawEventSnapshotSchema = z.object({
  id: recordIdSchema, type: z.enum(EventType), detail: eventTextSchema,
  fromStatus: z.enum(Status).nullable(), toStatus: z.enum(Status).nullable(),
  createdAt: timestamp,
}).strict();
export const eventSnapshotSchema = rawEventSnapshotSchema.transform((event, context) => {
  if (event.type !== EventType.STATUS_CHANGE) {
    if (event.fromStatus !== null || event.toStatus !== null) {
      context.addIssue({ code: "custom", message: "Only status change events can include status fields" });
      return z.NEVER;
    }
    if (event.type === EventType.NOTE_ADDED && (!event.detail || event.detail.trim() !== event.detail)) {
      context.addIssue({ code: "custom", message: "A dated note must have text without leading or trailing spaces" });
      return z.NEVER;
    }
    const followUp = event.type === EventType.NOTE_ADDED ? null : parseFollowUpEventDetail(event.detail);
    if (event.type !== EventType.NOTE_ADDED && (!followUp || (event.type === EventType.FOLLOW_UP_DONE && followUp.note !== null))) {
      context.addIssue({ code: "custom", message: "A follow-up event must name its date, and a set follow-up may add its note" });
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
export const interviewSnapshotSchema = z.object({
  id: recordIdSchema, date: storedCalendarDateSchema, time: storedTimeSchema, type: z.enum(InterviewType),
  interviewers: storedOptionalText(200), notes: storedOptionalText(2_000), createdAt: timestamp,
}).strict();
export const contactSnapshotSchema = z.object({
  id: recordIdSchema, name: storedRequiredText(120), role: storedOptionalText(120),
  email: storedOptionalText(254).refine((value) => value === null || z.email().safeParse(value).success, "Enter a valid email address"),
  linkedinUrl: storedHttpUrlSchema, notes: storedOptionalText(2_000), createdAt: timestamp,
}).strict();
export const applicationFieldsSchema = z.object({
  id: applicationIdSchema, company: storedRequiredText(120), role: storedRequiredText(120),
  status: z.enum(Status), archived: z.boolean(), source: storedOptionalText(120), appliedDate: storedCalendarDateSchema,
  interviewDatePromptDismissed: z.boolean(), followUpDate: storedCalendarDateSchema.nullable(), followUpNote: storedOptionalText(200),
  notes: storedOptionalText(5_000), jobUrl: storedJobUrlSchema,
  createdAt: timestamp, lastUpdated: timestamp,
}).strict().superRefine((application, context) => {
  if (application.followUpNote !== null && application.followUpDate === null) {
    context.addIssue({ code: "custom", path: ["followUpNote"], message: "A follow-up note needs a follow-up date" });
  }
});

type HistoryEvent = z.output<typeof eventSnapshotSchema>;
type HistoryIssue = (path: (string | number)[], message: string) => void;

/** Consumes timestamp-ordered events; each timestamp uses at most Status² counters. */
export class BackupHistoryValidator {
  private time: number | null = null;
  private firstTime: number | null = null;
  private groupIndex = 0;
  private initialCount = 0;
  private initial: Status | null = null;
  private unknown = false;
  private edges = new Map<string, TypedTransition>();
  private previous: Set<Status> | null = null;
  private complete = false;

  private issue: HistoryIssue;

  constructor(issue: HistoryIssue) { this.issue = issue; }

  add(event: HistoryEvent, index: number) {
    if (event.type !== EventType.STATUS_CHANGE) return;
    const time = event.createdAt.getTime();
    if (this.time !== time) {
      this.flush();
      this.time = time;
      this.firstTime ??= time;
      this.groupIndex = index;
    }
    if (event.toStatus === null) this.unknown = true;
    else if (event.fromStatus === null) {
      this.initialCount++;
      if (this.initialCount > 1) this.issue(["events"], "History can contain only one initial status event");
      if (time !== this.firstTime) this.issue(["events", index, "fromStatus"], "An initial status event must be first");
      this.initial = event.toStatus;
      if (time === this.firstTime && this.initialCount === 1) this.complete = true;
    } else {
      const key = `${event.fromStatus}:${event.toStatus}`;
      const edge = this.edges.get(key) ?? { fromStatus: event.fromStatus, toStatus: event.toStatus, count: 0 };
      edge.count++;
      this.edges.set(key, edge);
    }
  }

  private flush() {
    if (this.time === null) return;
    if (this.unknown) {
      this.complete = false;
      this.previous = null;
    } else {
      const starts = this.initial ? [this.initial] : this.previous ? [...this.previous] : Object.values(Status);
      const ends = possibleTrailEnds([...this.edges.values()], starts);
      if (!ends.size && this.edges.size) {
        this.issue(["events", this.groupIndex, "fromStatus"], "Status transitions must form a consistent sequence");
        this.previous = null;
        this.complete = false;
      } else this.previous = ends;
    }
    this.initial = null;
    this.unknown = false;
    this.edges.clear();
  }

  finish(status: Status) {
    this.flush();
    if (this.complete && this.previous && !this.previous.has(status)) {
      this.issue(["status"], "Saved status must match the final status in history");
    }
  }
}

export function validateBackupEventTime(event: HistoryEvent, now: number, issue: HistoryIssue, index: number) {
  if (event.createdAt.getTime() > now) issue(["events", index, "createdAt"], "Event time must not be in the future");
}

export const applicationSnapshotSchema = applicationFieldsSchema.extend({
  events: z.array(eventSnapshotSchema), interviews: z.array(interviewSnapshotSchema), contacts: z.array(contactSnapshotSchema),
}).superRefine((application, context) => {
  const history = new BackupHistoryValidator((path, message) => context.addIssue({ code: "custom", path, message }));
  application.events.map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.createdAt.getTime() - b.event.createdAt.getTime() || a.index - b.index)
    .forEach(({ event, index }) => history.add(event, index));
  history.finish(application.status);
});
// Undo restore and the import duplicate comparison read rows this server stored itself, so they check
// field types only. They must not reuse the import rules above: rows stored under older rules would
// otherwise be lost on undo, or turn an import conflict into a validation error.
const storedTimestamp = z.iso.datetime().transform((value) => new Date(value));
const storedEventSchema = z.object({
  id: z.string().min(1), type: z.enum(EventType), detail: z.string().nullable(),
  fromStatus: z.enum(Status).nullable(), toStatus: z.enum(Status).nullable(),
  createdAt: storedTimestamp,
}).strict();
const storedInterviewSchema = z.object({
  id: z.string().min(1), date: storedTimestamp, time: z.string().nullable(), type: z.enum(InterviewType),
  interviewers: z.string().nullable(), notes: z.string().nullable(), createdAt: storedTimestamp,
}).strict();
const storedContactSchema = z.object({
  id: z.string().min(1), name: z.string(), role: z.string().nullable(), email: z.string().nullable(),
  linkedinUrl: z.string().nullable(), notes: z.string().nullable(), createdAt: storedTimestamp,
}).strict();
export const applicationRestoreSnapshotSchema = z.object({
  id: z.string().min(1), company: z.string(), role: z.string(), status: z.enum(Status), archived: z.boolean(),
  revision: z.number().int().nonnegative(), source: z.string().nullable(), appliedDate: storedTimestamp,
  interviewDatePromptDismissed: z.boolean(), followUpDate: storedTimestamp.nullable(), followUpNote: z.string().nullable(),
  notes: z.string().nullable(), jobUrl: z.string().nullable(), createdAt: storedTimestamp, lastUpdated: storedTimestamp,
  events: z.array(storedEventSchema), interviews: z.array(storedInterviewSchema), contacts: z.array(storedContactSchema),
}).strict();

type StoredChildren = {
  events: Array<{ id: string; type: EventType; detail: string | null; fromStatus?: Status | null; toStatus?: Status | null; createdAt: string | Date }>;
  interviews: Array<{ id: string; date: string | Date; time: string | null; type: InterviewType; interviewers: string | null; notes: string | null; createdAt: string | Date }>;
  contacts: Array<{ id: string; name: string; role: string | null; email: string | null; linkedinUrl: string | null; notes: string | null; createdAt: string | Date }>;
};
const asString = (date: unknown) => date instanceof Date ? date.toISOString() : date;

/** Keeps only the stored child fields (dropping `applicationId`), with dates as ISO strings. */
export function storedChildren({ events, interviews, contacts }: StoredChildren) {
  return {
    events: events.map((event) => ({
      id: event.id, type: event.type, detail: event.detail, fromStatus: event.fromStatus, toStatus: event.toStatus,
      createdAt: asString(event.createdAt),
    })),
    interviews: interviews.map((interview) => ({
      id: interview.id, date: asString(interview.date), time: interview.time, type: interview.type,
      interviewers: interview.interviewers, notes: interview.notes, createdAt: asString(interview.createdAt),
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id, name: contact.name, role: contact.role, email: contact.email, linkedinUrl: contact.linkedinUrl,
      notes: contact.notes, createdAt: asString(contact.createdAt),
    })),
  };
}
const storedComparisonSchema = applicationRestoreSnapshotSchema.omit({ revision: true });
export const backupEnvelopeSchema = z.object({ version: z.literal(1), settings: settingsSchema }).strict();
export const backupSnapshotSchema = backupEnvelopeSchema.extend({
  applications: z.array(applicationSnapshotSchema),
}).strict().superRefine((backup, context) => {
  const now = Date.now();
  const ids = { applications: new Set<string>(), events: new Set<string>(), interviews: new Set<string>(), contacts: new Set<string>() };
  backup.applications.forEach((application, applicationIndex) => {
    const issue: HistoryIssue = (path, message) => context.addIssue({ code: "custom", path: ["applications", applicationIndex, ...path], message });
    if (ids.applications.has(application.id)) issue(["id"], "Backup contains duplicate IDs");
    ids.applications.add(application.id);
    for (const kind of ["events", "interviews", "contacts"] as const) {
      application[kind].forEach((child, index) => {
        if (ids[kind].has(child.id)) issue([kind, index, "id"], "Backup contains duplicate IDs");
        ids[kind].add(child.id);
      });
    }
    application.events.forEach((event, index) => validateBackupEventTime(event, now, issue, index));
  });
});
export type BackupSnapshot = z.input<typeof backupSnapshotSchema>;

export function canonicalSnapshot(value: unknown) {
  const input = value as Record<string, unknown> & StoredChildren;
  const { revision, events, interviews, contacts, ...snapshotInput } = input;
  void revision;
  const record = storedComparisonSchema.parse({
    ...snapshotInput,
    appliedDate: asString(snapshotInput.appliedDate),
    followUpDate: asString(snapshotInput.followUpDate),
    createdAt: asString(snapshotInput.createdAt),
    lastUpdated: asString(snapshotInput.lastUpdated),
    ...storedChildren({ events, interviews, contacts }),
  });
  const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
  return JSON.stringify({
    ...record,
    events: [...record.events].sort(byId),
    interviews: [...record.interviews].sort(byId),
    contacts: [...record.contacts].sort(byId),
  });
}
