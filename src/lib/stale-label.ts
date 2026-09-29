import { daysAgoPhrase } from "@/lib/application-date";
import type { StaleApplication } from "@/types/dashboard";

export function staleAgeLabel({ staleDays, staleSince }: Pick<StaleApplication, "staleDays" | "staleSince">) {
  const age = daysAgoPhrase(staleDays);
  return staleSince === "APPLIED_DATE" ? `Applied ${age}, no status update since` : `Last status update ${age}`;
}
