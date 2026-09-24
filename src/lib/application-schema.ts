import { Status } from "@prisma/client";
import { z } from "zod";

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
      .refine((value) => {
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, {
        message: "Job URL must use HTTP or HTTPS",
      }),
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

export const applicationInputSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(120),
  role: z.string().trim().min(1, "Role is required").max(120),
  status: z.enum(Status),
  source: optionalText(120),
  appliedDate: appliedDateSchema,
  interviewDate: optionalInterviewDateSchema,
  notes: optionalText(5_000),
  jobUrl: optionalUrl,
});

export const applicationStatusSchema = z.object({
  status: z.enum(Status),
  archived: z.boolean().optional(),
  interviewDate: patchInterviewDateSchema,
  interviewDatePromptDismissed: z.boolean().optional(),
});

export const applicationArchiveSchema = z.object({
  archived: z.boolean(),
}).strict();

export const applicationMutationSchema = z.union([
  applicationStatusSchema,
  applicationArchiveSchema,
]);

export type ApplicationInput = z.input<typeof applicationInputSchema>;
