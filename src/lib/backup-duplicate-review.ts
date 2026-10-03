import { prepareDuplicateReview, readStagedDuplicate } from "@/lib/backup-staging";
import type { DuplicateMatch } from "@/lib/duplicate-match";
import { prisma } from "@/lib/prisma";
import type { ApplicationSummary } from "@/types/application";

/** Populate an indexed, temporary review snapshot in bounded pages; matching runs in the worker. */
export async function stagedDuplicate(token: string, position: number): Promise<DuplicateMatch<ApplicationSummary> | null> {
  await prepareDuplicateReview(token, async (add) => {
    let offset = 0;
    while (true) {
      const page = await prisma.application.findMany({ orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: offset, take: 200, omit: { notes: true } });
      if (!page.length) break;
      await add(page.map((record) => ({ ...record, appliedDate: record.appliedDate.toISOString(), followUpDate: record.followUpDate?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(), lastUpdated: record.lastUpdated.toISOString(), interviews: [] })));
      offset += page.length;
    }
  });
  return readStagedDuplicate(token, position);
}
