import type { Prisma } from "@prisma/client";

import type { ApplicationRecord } from "@/types/application";

/** Every API response that returns an application includes its interview rounds and contacts in display order. */
export const applicationInclude = {
  interviews: { orderBy: [{ date: "asc" }, { time: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
  contacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ApplicationInclude;

export type StoredApplication = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>;

/** Server pages pass plain JSON to the client, the same shape API responses produce. */
export function serializeApplication(application: StoredApplication): ApplicationRecord {
  return JSON.parse(JSON.stringify(application)) as ApplicationRecord;
}
