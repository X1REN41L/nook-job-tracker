"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { DashboardMetricCard, formatDashboardPercentage } from "@/components/dashboard-metric-card";
import type { DashboardOverviewData as OverviewData, StaleApplication } from "@/types/dashboard";
import type { ApplicationRecord } from "@/types/application";
import { currentBrowserTimeZone } from "@/lib/application-date";
import { applicationTableHref } from "@/lib/application-list";
import { boardLabel } from "@/lib/board-preferences";
import { useBoards } from "@/hooks/use-boards";
import { useSettings } from "@/hooks/use-settings";
import { useStaleApplications } from "@/hooks/use-stale-applications";
import { staleAgeLabel } from "@/lib/stale-label";

type Rate = OverviewData["interviewRate"];

function OverviewMetrics({ data }: { data: OverviewData | null }) {
  const rateCard = (label: string, rate: Rate | undefined) => (
    <DashboardMetricCard
      label={label}
      value={rate ? formatDashboardPercentage(rate.percentage) : "—"}
      detail={rate ? `${rate.numerator} of ${rate.denominator}` : " "}
      coverage={rate?.historyCoverage}
      explanation="Percentage of applications that reached this exact status. Each status is counted independently."
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Overview metrics">
      <DashboardMetricCard label="Total Applications" value={data?.totalApplications ?? "—"} detail="All time" href={applicationTableHref({ archived: "all" })} />
      <DashboardMetricCard label="Active Pipeline" value={data?.activePipeline ?? "—"} detail="Currently active" href={applicationTableHref({ status: "active" })} />
      <DashboardMetricCard label="Active upcoming interviews" value={data?.upcomingInterviews.count ?? "—"} detail="Upcoming" href="/interviews" />
      {rateCard("Interview Rate", data?.interviewRate)}
      {rateCard("Offer Rate", data?.offerRate)}
    </div>
  );
}

const linkClass = "shrink-0 rounded-nook-sm px-1 py-1 text-sm font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";
const severityClass = {
  CRITICAL: "text-rose",
  HIGH: "text-clay",
  MEDIUM: "text-gold",
} as const;

function PreviewHeading({ id, title, action }: { id: string; title: string; action: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line pb-3">
      <h2 className="min-w-0 font-serif text-xl font-semibold leading-tight" id={id}>{title}</h2>
      {action}
    </div>
  );
}

function NeedsAttentionRow({ item, application, archiveDisabled, onOpen, onArchive }: {
  item: StaleApplication;
  application: ApplicationRecord | undefined;
  archiveDisabled: boolean;
  onOpen: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  const boards = useBoards();
  return (
    <li className="stale-application-row relative min-w-0">
      <button
        className="block w-full min-w-0 rounded-nook-sm py-4 pl-2 pr-24 text-left motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest disabled:hover:bg-transparent"
        disabled={!application}
        onClick={() => { if (application) onOpen(application); }}
        type="button"
      >
        <span className={`block text-xs font-semibold tracking-wide ${severityClass[item.severity]}`}>{item.severity}</span>
        <span className="mt-1 block break-words text-sm font-semibold leading-5 text-ink">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></span>
        <span className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>{staleAgeLabel(item)}</span>
          <span>{boardLabel(boards, item.status)}</span>
        </span>
      </button>
      {application && (
        <button
          className="stale-row-archive btn-ghost absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
          disabled={archiveDisabled}
          onClick={() => onArchive(application)}
          type="button"
        >
          Archive
        </button>
      )}
    </li>
  );
}

function NeedsAttention({ preview, loading, error, today, refreshKey, initiallyExpanded, applications, movingIds, onOpen, onArchive }: {
  preview: OverviewData["staleApplications"];
  loading: boolean;
  error: boolean;
  today: string;
  refreshKey: unknown;
  initiallyExpanded: boolean;
  applications: ApplicationRecord[];
  movingIds: ReadonlySet<string>;
  onOpen: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const full = useStaleApplications(today, refreshKey, expanded);
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const fullItems = full.data
    ? [...full.data.applicationsBySeverity.CRITICAL, ...full.data.applicationsBySeverity.HIGH, ...full.data.applicationsBySeverity.MEDIUM]
      .filter((item) => applicationById.get(item.id)?.archived === false)
    : null;
  const items = expanded ? fullItems ?? [] : preview.filter((item) => applicationById.get(item.id)?.archived !== true);
  const excluded = expanded ? full.data?.timingCoverage.withoutReliableStatusTimestamp ?? 0 : 0;
  const listLoading = expanded ? !full.data && !full.error : loading;
  const listError = expanded ? full.error : error;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    // Keep the address in step so reloading keeps the full list open.
    window.history.replaceState(null, "", next ? "/dashboard?attention=all" : "/dashboard");
  }

  return (
    <section className="min-w-0" aria-labelledby="needs-attention-title">
      <PreviewHeading
        id="needs-attention-title"
        title="Needs Attention"
        action={(expanded || preview.length >= 3) && (
          <button aria-expanded={expanded} className={linkClass} onClick={toggle} type="button">
            {expanded ? "Show fewer" : <>View all <span aria-hidden="true">→</span></>}
          </button>
        )}
      />
      {expanded && <p className="mt-3 text-sm text-ink-soft">Active applications with no recent status movement, longest waiting first.</p>}
      {excluded > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          {excluded} active {excluded === 1 ? "application is" : "applications are"} not shown because reliable status timing is unavailable.
        </p>
      )}
      {listLoading ? (
        <p className="py-6 text-sm text-ink-soft" role={expanded ? "status" : undefined}>Loading applications…</p>
      ) : listError ? (
        <p className="py-6 text-sm text-ink-soft">{expanded ? "Needs Attention could not be loaded. Please try again later." : "Preview unavailable."}</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">{expanded ? "Nothing's gone quiet yet — good sign." : "No applications need attention right now."}</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {items.map((item) => (
            <NeedsAttentionRow application={applicationById.get(item.id)} archiveDisabled={movingIds.has(item.id)} item={item} key={item.id} onArchive={onArchive} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UpcomingInterviewsPreview({ items, loading, error }: { items: OverviewData["upcomingInterviews"]["items"]; loading: boolean; error: boolean }) {
  return (
    <section className="min-w-0" aria-labelledby="upcoming-preview-title">
      <PreviewHeading
        id="upcoming-preview-title"
        title="Upcoming Interviews"
        action={<Link className={linkClass} href="/interviews">View all <span aria-hidden="true">→</span></Link>}
      />
      {loading ? (
        <p className="py-6 text-sm text-ink-soft">Loading interviews…</p>
      ) : error ? (
        <p className="py-6 text-sm text-ink-soft">Preview unavailable.</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">All caught up — no interviews on the horizon.</p>
      ) : (
        <div className="divide-y divide-line/70">
          {items.slice(0, 3).map((item) => (
            <article key={item.id} className="min-w-0 py-4 first:pt-5">
              <p className="text-sm font-medium text-forest">{item.daysUntilInterview === 0 ? "Today" : item.daysUntilInterview === 1 ? "Tomorrow" : `In ${item.daysUntilInterview} days`}</p>
              <h3 className="mt-1 break-words text-sm font-semibold leading-5">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></h3>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardOverview({ today, refreshKey, expandAttention, applications, movingIds, onOpen, onArchive }: {
  today: string;
  refreshKey: unknown;
  expandAttention: boolean;
  applications: ApplicationRecord[];
  movingIds: ReadonlySet<string>;
  onOpen: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  const staleApplicationThreshold = useSettings().staleApplicationThreshold;
  const [result, setResult] = useState<{ today: string; threshold: number; data: OverviewData } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ today, timeZone: currentBrowserTimeZone(), staleApplicationThreshold: String(staleApplicationThreshold) });
    fetch(`/api/dashboard/overview?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Overview request failed");
        return response.json() as Promise<OverviewData>;
      })
      .then((overview) => {
        setResult({ today, threshold: staleApplicationThreshold, data: overview });
        setError(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load Overview", reason);
        setResult(null);
        setError(true);
      });
    return () => controller.abort();
  }, [today, refreshKey, staleApplicationThreshold]);

  const data = result?.today === today && result.threshold === staleApplicationThreshold ? result.data : null;
  const loading = !data && !error;

  return (
    <section className="w-full min-w-0 pb-10" aria-labelledby="overview-heading">
      <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight" id="overview-heading">Overview</h1>
      {error && <p className="mt-4 rounded-nook-sm border border-rose bg-rose-tint px-4 py-3 text-sm text-ink" role="alert">Overview could not be loaded. Please try again later.</p>}
      {loading && <p className="sr-only" role="status">Loading Overview</p>}
      <div className="mt-7">
        <OverviewMetrics data={data} />
      </div>
      <div className="mt-9 grid min-w-0 grid-cols-1 gap-x-8 gap-y-9 lg:grid-cols-2">
        <NeedsAttention
          applications={applications}
          error={error}
          initiallyExpanded={expandAttention}
          loading={loading}
          movingIds={movingIds}
          onArchive={onArchive}
          onOpen={onOpen}
          preview={data?.staleApplications ?? []}
          refreshKey={refreshKey}
          today={today}
        />
        <UpcomingInterviewsPreview items={data?.upcomingInterviews.items ?? []} loading={loading} error={error} />
      </div>
    </section>
  );
}
