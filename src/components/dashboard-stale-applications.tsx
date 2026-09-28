"use client";

import { useEffect, useState } from "react";

import { currentBrowserTimeZone } from "@/lib/application-date";
import { useSettings } from "@/hooks/use-settings";
import { useBoards } from "@/hooks/use-boards";
import { boardLabel } from "@/lib/board-preferences";
import type { ApplicationRecord } from "@/types/application";
import type { StaleApplication, StaleApplicationsData as StaleData, StaleSeverity as Severity } from "@/types/dashboard";

const severityOrder: Severity[] = ["CRITICAL", "HIGH", "MEDIUM"];
const severityColor: Record<Severity, string> = {
  CRITICAL: "text-rose",
  HIGH: "text-clay",
  MEDIUM: "text-gold",
};

function StaleApplicationRow({ application, onEdit, onArchive, archiveDisabled }: {
  application: StaleApplication;
  onEdit: () => void;
  onArchive: () => void;
  archiveDisabled: boolean;
}) {
  const boards = useBoards();
  return (
    <li className="stale-application-row relative min-w-0">
      <button
        className="block w-full min-w-0 rounded-nook-sm py-4 pl-2 pr-24 text-left motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest"
        onClick={onEdit}
        type="button"
      >
        <span className="block break-words text-sm font-semibold leading-5 text-ink">
          {application.role} <span className="font-medium text-ink-soft">— {application.company}</span>
        </span>
        <span className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>{boardLabel(boards, application.status)}</span>
          <span>Last status update {application.staleDays} {application.staleDays === 1 ? "day" : "days"} ago</span>
        </span>
      </button>
      <button
        className="stale-row-archive btn-ghost absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
        disabled={archiveDisabled}
        onClick={onArchive}
        type="button"
      >
        Archive
      </button>
    </li>
  );
}

function StaleSeveritySection({ severity, items, applicationById, onEdit, onArchive, movingIds }: {
  severity: Severity;
  items: StaleApplication[];
  applicationById: Map<string, ApplicationRecord>;
  onEdit: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
  movingIds: ReadonlySet<string>;
}) {
  if (items.length === 0) return null;

  const headingId = `stale-${severity.toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2 className={`border-b border-line pb-3 text-sm font-semibold tracking-wide ${severityColor[severity]}`} id={headingId}>
        {severity} <span className="text-ink-soft">· {items.length}</span>
      </h2>
      <ul className="divide-y divide-line/70">
        {items.map((item) => {
          const record = applicationById.get(item.id);
          if (!record) return null;
          return <StaleApplicationRow application={item} archiveDisabled={movingIds.has(item.id)} key={item.id} onArchive={() => onArchive(record)} onEdit={() => onEdit(record)} />;
        })}
      </ul>
    </section>
  );
}

export function DashboardStaleApplications({ today, refreshKey, applications, onEdit, onArchive, movingIds }: {
  today: string;
  refreshKey: unknown;
  applications: ApplicationRecord[];
  onEdit: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
  movingIds: ReadonlySet<string>;
}) {
  const staleApplicationThreshold = useSettings().staleApplicationThreshold;
  const [result, setResult] = useState<{ today: string; threshold: number; data: StaleData } | null>(null);
  const [failedToday, setFailedToday] = useState<string | null>(null);

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ today, timeZone: currentBrowserTimeZone(), staleApplicationThreshold: String(staleApplicationThreshold) });
    fetch(`/api/dashboard/stale?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Stale applications request failed");
        return response.json() as Promise<StaleData>;
      })
      .then((data) => {
        setResult({ today, threshold: staleApplicationThreshold, data });
        setFailedToday(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load Stale Applications", reason);
        setFailedToday(today);
      });
    return () => controller.abort();
  }, [today, refreshKey, staleApplicationThreshold]);

  const data = result?.today === today && result.threshold === staleApplicationThreshold ? result.data : null;
  const error = failedToday === today;
  const loading = !data && !error;
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const visibleGroups = severityOrder.map((severity) => ({
    severity,
    items: data?.applicationsBySeverity[severity].filter((item) => applicationById.get(item.id)?.archived === false) ?? [],
  }));
  const visibleCount = visibleGroups.reduce((count, group) => count + group.items.length, 0);
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
        visibleCount === 0 ? (
          <p className="mt-8 text-sm text-ink-soft">{"Nothing's gone quiet yet — good sign."}</p>
        ) : (
          <div className="mt-9 space-y-8">
            {visibleGroups.map(({ severity, items }) => (
              <StaleSeveritySection applicationById={applicationById} items={items} key={severity} onArchive={onArchive} movingIds={movingIds} onEdit={onEdit} severity={severity} />
            ))}
          </div>
        )
      )}
    </section>
  );
}
