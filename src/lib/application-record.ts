import type { Prisma } from "@prisma/client";

import type { ApplicationSummary } from "@/types/application";

/** Every API response that returns an application includes its interview rounds and contacts in display order. */
export const applicationInclude = {
  interviews: { orderBy: [{ date: "asc" }, { time: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
  contacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
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
