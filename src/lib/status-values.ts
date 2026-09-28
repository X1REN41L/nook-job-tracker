import type { Status } from "@prisma/client";

export const STATUS_VALUES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"] as const satisfies readonly Status[];
