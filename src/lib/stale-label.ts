import { daysAgoPhrase } from "@/lib/application-date";
import type { StaleApplication } from "@/types/dashboard";

export function staleAgeLabel({ staleDays, staleSince }: Pick<StaleApplication, "staleDays" | "staleSince">) {
  const age = daysAgoPhrase(staleDays);
  if (staleSince === "APPLIED_DATE") return `Applied ${age}, no status update since`;
  return staleSince === "INTERVIEW" ? `Last interview ${age}, no status update since` : `Last status update ${age}`;
}
