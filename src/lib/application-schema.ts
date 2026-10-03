import { InterviewType, Status } from "@prisma/client";
import { z } from "zod";

import { parseCalendarDateKey } from "@/lib/calendar-date";

const MAX_EVENT_TEXT_LENGTH = 5_000;
const JOB_URL_MESSAGE = "Job URL must use HTTP or HTTPS";
const RESERVED_APPLICATION_IDS = new Set(["export", "import", "purge", "bulk-delete", "bulk-restore"]);

const isTrimmed = (value: string) => value.trim() === value;

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const optionalHttpUrl = (message: string) => z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .url("Enter a valid URL")
      .max(2_000)
      .refine(isHttpUrl, { message }),
  ])
  .optional()
  .transform((value) => value || null);
const optionalUrl = optionalHttpUrl(JOB_URL_MESSAGE);

const appliedDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Applied date is required")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid applied date")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const calendarDateInput = (message: string) => z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, message)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, message)
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export const interviewDateSchema = calendarDateInput("Enter a valid interview date");
const followUpDateSchema = calendarDateInput("Enter a valid follow-up date");

const optionalFollowUpDateSchema = z
  .union([z.literal(""), z.null(), followUpDateSchema])
  .optional()
  .transform((value) => value || null);

// A local wall-clock time, "HH:MM" in 24-hour form.
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const optionalTimeSchema = z
  .union([z.literal(""), z.null(), z.string().regex(TIME_PATTERN, "Enter a valid time")])
  .optional()
  .transform((value) => value || null);

const optionalEmailSchema = z
  .union([z.literal(""), z.string().trim().max(254).pipe(z.email("Enter a valid email address"))])
  .optional()
  .transform((value) => value || null);

// Stored-value validators: backup import checks values exactly as Nook stores and exports them,
// and rejects anything else rather than trimming or converting it.
export const recordIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "IDs must be 1-64 letters, digits, hyphens or underscores");

export const applicationIdSchema = recordIdSchema.refine((value) => !RESERVED_APPLICATION_IDS.has(value), "This ID is reserved");

// A calendar date is stored as UTC midnight and exported as `YYYY-MM-DDT00:00:00.000Z`.
export const storedCalendarDateSchema = z
  .string()
  .refine((value) => {
    const match = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/.exec(value);
    return match !== null && parseCalendarDateKey(match[1]) !== null;
  }, "Calendar dates must be UTC midnight (YYYY-MM-DDT00:00:00.000Z)")
  .transform((value) => new Date(value));

export const storedRequiredText = (max: number) => z
  .string()
  .min(1)
  .max(max)
  .refine(isTrimmed, "Text must not have leading or trailing spaces");

// Empty values are stored as null, never as "" or whitespace.
export const storedOptionalText = (max: number) => storedRequiredText(max).nullable();

const storedUrl = (label: string) => z
  .string()
  .max(2_000)
  .refine(isTrimmed, `${label} must not have leading or trailing spaces`)
  .url("Enter a valid URL")
  .refine(isHttpUrl, { message: `${label} must use HTTP or HTTPS` })
  .nullable();
export const storedJobUrlSchema = storedUrl("Job URL");
export const storedHttpUrlSchema = storedUrl("Link");

export const eventTextSchema = z.string().max(MAX_EVENT_TEXT_LENGTH).nullable();

export const applicationInputSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(120),
  role: z.string().trim().min(1, "Role is required").max(120),
  status: z.enum(Status),
  source: optionalText(120),
  appliedDate: appliedDateSchema,
  notes: optionalText(5_000),
  jobUrl: optionalUrl,
}).strict();

const applicationRevisionSchema = z.number().int().nonnegative();

// Editing changes the details only; status and follow-up change through PATCH, which keeps status history.
export const applicationEditSchema = applicationInputSchema.omit({ status: true }).extend({
  revision: applicationRevisionSchema,
}).strict();

const applicationStatusSchema = z.object({
  revision: applicationRevisionSchema,
  status: z.enum(Status),
  archived: z.boolean().optional(),
  interviewDatePromptDismissed: z.boolean().optional(),
}).strict();

const applicationArchiveSchema = z.object({
  revision: applicationRevisionSchema,
  archived: z.boolean(),
}).strict();

// Setting a follow-up replaces its note; clearing the date clears the note too.
const applicationFollowUpSchema = z.object({
  revision: applicationRevisionSchema,
  followUpDate: optionalFollowUpDateSchema,
  followUpNote: optionalText(200),
}).strict();

export const applicationStatusUndoSchema = z.object({
  revision: applicationRevisionSchema,
  expectedLatestStatusEventId: recordIdSchema,
  archived: z.boolean(),
  interviewDatePromptDismissed: z.boolean(),
  /** The interview round added through the date prompt that followed the move; undoing the move removes it. */
  promptInterviewId: recordIdSchema.optional(),
}).strict();

export const applicationMutationSchema = z.union([
  applicationStatusSchema,
  applicationArchiveSchema,
  applicationFollowUpSchema,
]);

// Interview rounds, contacts, and dated notes change their application's revision, so each request carries it.
export const revisionOnlySchema = z.object({ revision: applicationRevisionSchema }).strict();

export const interviewInputSchema = z.object({
  revision: applicationRevisionSchema,
  date: interviewDateSchema,
  time: optionalTimeSchema,
  type: z.enum(InterviewType),
  interviewers: optionalText(200),
  notes: optionalText(2_000),
}).strict();

export const contactInputSchema = z.object({
  revision: applicationRevisionSchema,
  name: z.string().trim().min(1, "Name is required").max(120),
  role: optionalText(120),
  email: optionalEmailSchema,
  linkedinUrl: optionalHttpUrl("LinkedIn URL must use HTTP or HTTPS"),
  notes: optionalText(2_000),
}).strict();

export const noteInputSchema = z.object({
  revision: applicationRevisionSchema,
  text: z.string().trim().min(1, "Write a note first").max(MAX_EVENT_TEXT_LENGTH),
}).strict();

export const storedTimeSchema = z.string().regex(TIME_PATTERN, "Times must be HH:MM").nullable();
