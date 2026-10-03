import { z } from "zod";

import { revisionOnlySchema } from "@/lib/application-schema";

/** The most applications one bulk delete or restore handles; more than the table ever selects at once in practice. */
const MAX_BULK_APPLICATIONS = 1_000;

const bulkApplicationIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(MAX_BULK_APPLICATIONS)
  .refine((ids) => new Set(ids).size === ids.length, "Application IDs must be unique");

export const bulkDeleteRequestSchema = z.object({
  applications: z.array(revisionOnlySchema.extend({ id: z.string().min(1).max(64) }).strict())
    .min(1).max(MAX_BULK_APPLICATIONS)
    .refine((applications) => new Set(applications.map(({ id }) => id)).size === applications.length, "Application IDs must be unique"),
}).strict();
export const bulkRestoreRequestSchema = z.object({ token: z.uuid(), ids: bulkApplicationIdsSchema }).strict();

/**
 * A bulk delete keeps one undo snapshot per application under a shared batch token, so the whole batch
 * restores together and expires together. Batch keys are not UUIDs, so the single-application restore
 * can't take one of them out of its batch.
 */
export function bulkSnapshotToken(batchToken: string, applicationId: string) {
  return `${batchToken}:${applicationId}`;
}
