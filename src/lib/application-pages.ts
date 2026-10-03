import { applicationApiPath } from "@/lib/application-api-path";
import type { ApplicationRecord, ApplicationSummary, ContactRecord, InterviewRecord } from "@/types/application";
import type { HistoryEvent } from "@/components/application-detail-sections";
import type { DashboardOverviewData, StaleApplicationsData } from "@/types/dashboard";

type Child = { id: string; createdAt: string };

export async function fetchApplicationChildren<T extends Child>(id: string, collection: string, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  let after = "";
  for (;;) {
    const query = new URLSearchParams({ owner: id, collection, after });
    const response = await fetch(`/api/applications?${query}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Could not load application items");
    const page = (await response.json())[collection] as T[];
    rows.push(...page);
    if (page.length < 200) break;
    after = page.at(-1)!.id;
  }
  return rows;
}

function sortInterviews(rows: InterviewRecord[]) {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function completeApplication(record: ApplicationRecord & { _count?: { interviews: number; contacts: number } }, signal?: AbortSignal): Promise<ApplicationRecord> {
  const interviews = record._count && record._count.interviews > record.interviews.length
    ? sortInterviews(await fetchApplicationChildren<InterviewRecord>(record.id, "interviews", signal)) : record.interviews;
  const contacts = record._count && record._count.contacts > record.contacts.length
    ? (await fetchApplicationChildren<ContactRecord>(record.id, "contacts", signal)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : record.contacts;
  return { ...record, interviews, contacts };
}

export async function fetchApplicationDetail(id: string, signal?: AbortSignal) {
  const response = await fetch(applicationApiPath(id), { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the application");
  const body = await response.json();
  const application = await completeApplication(body.application, signal);
  const events = (await fetchApplicationChildren<HistoryEvent>(id, "events", signal))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { application, events };
}

/** Hydrate only collections omitted by the bounded mutation response. */
export async function readApplicationResponse(response: Response) {
  const body = await response.json();
  if (body.application) body.application = await completeApplication(body.application);
  if (body.applications) {
    const records: ApplicationRecord[] = [];
    const returned = new Map<string, ApplicationRecord>(body.applications.map((record: ApplicationRecord) => [record.id, record]));
    for (const id of (body.conflictIds ?? body.restoredIds ?? [...returned.keys()]) as string[]) {
      const record = returned.get(id);
      records.push(record ? await completeApplication(record) : (await fetchApplicationDetail(id)).application);
    }
    body.applications = records;
  }
  return body;
}

export async function fetchApplicationSummaries(signal?: AbortSignal): Promise<ApplicationSummary[]> {
  const rows: ApplicationSummary[] = [];
  let after = "";
  for (;;) {
    const response = await fetch(`/api/applications?paged=1&after=${encodeURIComponent(after)}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Could not refresh applications. Reload to see the saved records.");
    const page = (await response.json()).applications as (ApplicationSummary & { interviewCount: number })[];
    for (const record of page) {
      if (record.interviewCount) record.interviews = sortInterviews(await fetchApplicationChildren<InterviewRecord>(record.id, "interviews", signal));
      rows.push(record);
    }
    if (page.length < 200) return rows;
    after = page.at(-1)!.id;
  }
}

export async function fetchDashboardOverview(query: URLSearchParams, signal?: AbortSignal): Promise<DashboardOverviewData> {
  let result: DashboardOverviewData | undefined;
  for (let offset = 0; ; offset += 200) {
    query.set("offset", String(offset));
    const response = await fetch(`/api/dashboard/overview?${query}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Could not load Overview");
    const page = await response.json() as DashboardOverviewData;
    if (!result) result = page;
    else result.followUps.push(...page.followUps);
    if (page.followUps.length < 200) return result;
  }
}

export async function fetchStaleApplications(query: URLSearchParams, signal?: AbortSignal): Promise<StaleApplicationsData> {
  let result: StaleApplicationsData | undefined;
  for (let offset = 0; ; offset += 200) {
    query.set("offset", String(offset));
    const response = await fetch(`/api/dashboard/stale?${query}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Could not load stale applications");
    const page = await response.json() as StaleApplicationsData;
    const groups = ["CRITICAL", "HIGH", "MEDIUM"] as const;
    if (!result) result = page;
    else {
      for (const severity of groups) result.applicationsBySeverity[severity].push(...page.applicationsBySeverity[severity]);
      result.archived.push(...page.archived);
    }
    if (page.archived.length < 200 && groups.every((severity) => page.applicationsBySeverity[severity].length < 200)) return result;
  }
}
