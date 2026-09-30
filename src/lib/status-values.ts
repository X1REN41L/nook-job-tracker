import type { Status } from "@prisma/client";

export const STATUS_VALUES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"] as const satisfies readonly Status[];
export const ACTIVE_PIPELINE_STATUSES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW"] as const satisfies readonly Status[];

/** Still in progress: not archived and not closed by an offer or rejection. */
export function isInProgressApplication(application: { archived: boolean; status: Status }) {
  return !application.archived && (ACTIVE_PIPELINE_STATUSES as readonly Status[]).includes(application.status);
}
