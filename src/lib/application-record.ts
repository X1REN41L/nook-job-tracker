import type { Prisma } from "@prisma/client";

import type { ApplicationSummary } from "@/types/application";
import { prisma } from "@/lib/prisma";

/** Every API response that returns an application includes its interview rounds and contacts in display order. */
export const applicationSnapshotInclude = {
  interviews: { orderBy: [{ date: "asc" }, { time: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
  contacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ApplicationInclude;

export const applicationInclude = {
  interviews: { ...applicationSnapshotInclude.interviews, take: 200 },
  contacts: { ...applicationSnapshotInclude.contacts, take: 200 },
  _count: { select: { interviews: true, contacts: true } },
} satisfies Prisma.ApplicationInclude;

export type StoredApplication = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>;

/** Pages load every application, so they leave out the notes and contacts that only the details panel shows. */
export const applicationSummaryQuery = {
  omit: { notes: true },
  include: { interviews: applicationInclude.interviews },
} satisfies Prisma.ApplicationFindManyArgs;

type StoredApplicationSummary = Prisma.ApplicationGetPayload<typeof applicationSummaryQuery>;

/** Server pages pass plain JSON to the client, the same shape API responses produce. */
export function serializeApplicationSummary(application: StoredApplicationSummary): ApplicationSummary {
  return JSON.parse(JSON.stringify(application)) as ApplicationSummary;
}

/** Traverse bounded queries so filtering, selection, and duplicate checks see all records. */
export async function loadApplicationSummaries(): Promise<ApplicationSummary[]> {
  const result: ApplicationSummary[] = [];
  let after = "";
  for (;;) {
    const page = await prisma.application.findMany({ where: { id: { gt: after } }, orderBy: { id: "asc" }, take: 200, omit: { notes: true } });
    if (!page.length) return result;
    for (const record of page) {
      const interviews = [];
      let childAfter = "";
      for (;;) {
        const children = await prisma.interview.findMany({ where: { applicationId: record.id, id: { gt: childAfter } }, orderBy: { id: "asc" }, take: 200 });
        if (!children.length) break;
        interviews.push(...children);
        childAfter = children.at(-1)!.id;
      }
      interviews.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.time ?? "").localeCompare(b.time ?? "") || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      result.push(serializeApplicationSummary({ ...record, interviews }));
    }
    after = page.at(-1)!.id;
  }
}
