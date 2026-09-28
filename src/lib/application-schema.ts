import { Status } from "@prisma/client";
import { z } from "zod";

import { parseCalendarDateKey } from "@/lib/calendar-date";

export const MAX_EVENT_TEXT_LENGTH = 5_000;
const JOB_URL_MESSAGE = "Job URL must use HTTP or HTTPS";
const RESERVED_APPLICATION_IDS = new Set(["export", "import", "purge"]);

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

const optionalUrl = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .url("Enter a valid URL")
      .max(2_000)
      .refine(isHttpUrl, { message: JOB_URL_MESSAGE }),
  ])
  .optional()
  .transform((value) => value || null);

const appliedDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Applied date is required")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid applied date")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export const interviewDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid interview date")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid interview date")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const optionalInterviewDateSchema = z
  .union([z.literal(""), interviewDateSchema])
  .optional()
  .transform((value) => value || null);

const patchInterviewDateSchema = z
  .union([z.literal(""), z.null(), interviewDateSchema])
  .optional()
  .transform((value) => value === undefined ? undefined : value || null);

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

export const storedJobUrlSchema = z
  .string()
  .max(2_000)
  .refine(isTrimmed, "Job URL must not have leading or trailing spaces")
  .url("Enter a valid URL")
  .refine(isHttpUrl, { message: JOB_URL_MESSAGE })
  .nullable();

export const eventTextSchema = z.string().max(MAX_EVENT_TEXT_LENGTH).nullable();

export const applicationInputSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(120),
  role: z.string().trim().min(1, "Role is required").max(120),
  status: z.enum(Status),
  source: optionalText(120),
  appliedDate: appliedDateSchema,
  interviewDate: optionalInterviewDateSchema,
  notes: optionalText(5_000),
  jobUrl: optionalUrl,
}).strict();

const applicationRevisionSchema = z.number().int().nonnegative();

export const applicationEditSchema = applicationInputSchema.extend({
  revision: applicationRevisionSchema,
}).strict();

export const applicationStatusSchema = z.object({
  revision: applicationRevisionSchema,
  status: z.enum(Status),
  archived: z.boolean().optional(),
  interviewDate: patchInterviewDateSchema,
  interviewDatePromptDismissed: z.boolean().optional(),
}).strict();

export const applicationArchiveSchema = z.object({
  revision: applicationRevisionSchema,
  archived: z.boolean(),
}).strict();

export const applicationStatusUndoSchema = z.object({
  revision: applicationRevisionSchema,
  expectedLatestStatusEventId: recordIdSchema,
  archived: z.boolean(),
  interviewDate: z.union([z.null(), interviewDateSchema]),
  interviewDatePromptDismissed: z.boolean(),
}).strict();

export const applicationMutationSchema = z.union([
  applicationStatusSchema,
  applicationArchiveSchema,
]);

export type ApplicationInput = z.input<typeof applicationInputSchema>;
