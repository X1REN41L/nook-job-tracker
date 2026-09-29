import type { StaleApplication } from "@/types/dashboard";

export function staleAgeLabel({ staleDays, staleSince }: Pick<StaleApplication, "staleDays" | "staleSince">) {
  const age = `${staleDays} ${staleDays === 1 ? "day" : "days"} ago`;
  return staleSince === "APPLIED_DATE" ? `Applied ${age}, no status update since` : `Last status update ${age}`;
}
