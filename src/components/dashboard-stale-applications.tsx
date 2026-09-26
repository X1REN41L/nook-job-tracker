"use client";

import { useEffect, useState } from "react";

import type { getStaleApplications, StaleApplication } from "@/lib/dashboard-analytics";
import { currentBrowserTimeZone } from "@/lib/application-date";
import { STATUS_META } from "@/lib/status-meta";
import type { ApplicationRecord } from "@/types/application";

type StaleData = Awaited<ReturnType<typeof getStaleApplications>>;
type Severity = StaleApplication["severity"];

const severityOrder: Severity[] = ["CRITICAL", "HIGH", "MEDIUM"];
const severityColor: Record<Severity, string> = {
  CRITICAL: "text-rose",
  HIGH: "text-clay",
  MEDIUM: "text-gold",
};

function StaleApplicationRow({ application, onEdit }: {
  application: StaleApplication;
  onEdit?: () => void;
}) {
  const content = (
    <>
      <span className="block break-words text-sm font-semibold leading-5 text-ink">
        {application.role} <span className="font-medium text-ink-soft">— {application.company}</span>
      </span>
      <span className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
        <span>{application.status === "ONLINE_ASSESSMENT" ? "Online Assessment" : STATUS_META[application.status].label}</span>
        <span>Last status update {application.staleDays} {application.staleDays === 1 ? "day" : "days"} ago</span>
      </span>
    </>
  );

  return (
    <li className="min-w-0">
      {onEdit ? (
        <button
          className="block w-full min-w-0 rounded-nook-sm px-2 py-4 text-left transition hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
          onClick={onEdit}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className="px-2 py-4">{content}</div>
      )}
    </li>
  );
}

function StaleSeveritySection({ severity, data, applicationById, onEdit }: {
  severity: Severity;
  data: StaleData;
  applicationById: Map<string, ApplicationRecord>;
  onEdit: (application: ApplicationRecord) => void;
}) {
  const items = data.applicationsBySeverity[severity];
  if (items.length === 0) return null;

  const headingId = `stale-${severity.toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 className={`border-b border-line pb-3 text-sm font-semibold tracking-wide ${severityColor[severity]}`} id={headingId}>
        {severity} <span className="text-ink-soft">· {data.counts[severity]}</span>
      </h2>
      <ul className="divide-y divide-line/70">
        {items.map((item) => {
          const record = applicationById.get(item.id);
          return <StaleApplicationRow application={item} key={item.id} onEdit={record ? () => onEdit(record) : undefined} />;
        })}
      </ul>
    </section>
  );
}

export function DashboardStaleApplications({ today, refreshKey, applications, onEdit }: {
  today: string;
  refreshKey: unknown;
  applications: ApplicationRecord[];
  onEdit: (application: ApplicationRecord) => void;
}) {
  const [result, setResult] = useState<{ today: string; data: StaleData } | null>(null);
  const [failedToday, setFailedToday] = useState<string | null>(null);

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ today, timeZone: currentBrowserTimeZone() });
    fetch(`/api/dashboard/stale?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Stale applications request failed");
        return response.json() as Promise<StaleData>;
      })
      .then((data) => {
        setResult({ today, data });
        setFailedToday(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load Stale Applications", reason);
        setFailedToday(today);
      });
    return () => controller.abort();
  }, [today, refreshKey]);

  const data = result?.today === today ? result.data : null;
  const error = failedToday === today;
  const loading = !data && !error;
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const excluded = data?.timingCoverage.withoutReliableStatusTimestamp ?? 0;

  return (
    <section aria-labelledby="stale-applications-heading" className="w-full min-w-0 pb-10">
      <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight" id="stale-applications-heading">Stale Applications</h1>
      <p className="mt-2 text-sm text-ink-soft">Applications with no recent status movement</p>
      {excluded > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          {excluded} active {excluded === 1 ? "application is" : "applications are"} not shown because reliable status timing is unavailable.
        </p>
      )}
      {error && <p className="mt-5 rounded-nook-sm border border-rose bg-rose-tint px-4 py-3 text-sm text-ink" role="alert">Stale Applications could not be loaded. Please try again later.</p>}
      {loading && <p className="mt-7 text-sm text-ink-soft" role="status">Loading applications…</p>}
      {data && !error && (
        data.counts.total === 0 ? (
          <p className="mt-8 text-sm text-ink-soft">No stale applications.</p>
        ) : (
          <div className="mt-9 space-y-8">
            {severityOrder.map((severity) => (
              <StaleSeveritySection applicationById={applicationById} data={data} key={severity} onEdit={onEdit} severity={severity} />
            ))}
          </div>
        )
      )}
    </section>
  );
}
