"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DashboardMetricCard, formatDashboardPercentage } from "@/components/dashboard-metric-card";
import type { getDashboardOverview } from "@/lib/dashboard-analytics";
import { currentBrowserTimeZone } from "@/lib/application-date";

type OverviewData = Awaited<ReturnType<typeof getDashboardOverview>>;
type Rate = OverviewData["interviewRate"];

function OverviewMetrics({ data }: { data: OverviewData | null }) {
  const rateCard = (label: string, rate: Rate | undefined) => (
    <DashboardMetricCard
      label={label}
      value={rate ? formatDashboardPercentage(rate.percentage) : "—"}
      detail={rate ? `${rate.numerator} of ${rate.denominator}` : " "}
      coverage={rate?.historyCoverage}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Overview metrics">
      <DashboardMetricCard label="Total Applications" value={data?.totalApplications ?? "—"} detail="All time" />
      <DashboardMetricCard label="Active Pipeline" value={data?.activePipeline ?? "—"} detail="Currently active" />
      <DashboardMetricCard label="Upcoming Interviews" value={data?.upcomingInterviews.count ?? "—"} detail="Upcoming" />
      {rateCard("Interview Rate", data?.interviewRate)}
      {rateCard("Offer Rate", data?.offerRate)}
    </div>
  );
}

function PreviewHeading({ id, title, href }: { id: string; title: string; href: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line pb-3">
      <h2 className="min-w-0 font-serif text-xl font-semibold leading-tight" id={id}>{title}</h2>
      <Link className="shrink-0 rounded-nook-sm px-1 py-1 text-sm font-medium text-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" href={href}>
        View all <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function NeedsAttentionPreview({ items, loading, error }: { items: OverviewData["staleApplications"]; loading: boolean; error: boolean }) {
  const severityClass = {
    CRITICAL: "text-rose",
    HIGH: "text-clay",
    MEDIUM: "text-gold",
  } as const;

  return (
    <section className="min-w-0" aria-labelledby="needs-attention-title">
      <PreviewHeading id="needs-attention-title" title="Needs Attention" href="/dashboard/stale" />
      {loading ? (
        <p className="py-6 text-sm text-ink-soft">Loading applications…</p>
      ) : error ? (
        <p className="py-6 text-sm text-ink-soft">Preview unavailable.</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">No applications need attention right now.</p>
      ) : (
        <div className="divide-y divide-line/70">
          {items.slice(0, 3).map((item) => (
            <article key={item.id} className="min-w-0 py-4 first:pt-5">
              <p className={`text-xs font-semibold tracking-wide ${severityClass[item.severity]}`}>{item.severity}</p>
              <h3 className="mt-1 break-words text-sm font-semibold leading-5">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></h3>
              <p className="mt-1 text-sm text-ink-soft">Last status update {item.staleDays} {item.staleDays === 1 ? "day" : "days"} ago</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingInterviewsPreview({ items, loading, error }: { items: OverviewData["upcomingInterviews"]["items"]; loading: boolean; error: boolean }) {
  return (
    <section className="min-w-0" aria-labelledby="upcoming-preview-title">
      <PreviewHeading id="upcoming-preview-title" title="Upcoming Interviews" href="/interviews" />
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
              <p className="text-sm font-medium text-forest">{item.daysUntilInterview === 0 ? "Today" : `In ${item.daysUntilInterview} ${item.daysUntilInterview === 1 ? "day" : "days"}`}</p>
              <h3 className="mt-1 break-words text-sm font-semibold leading-5">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></h3>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardOverview({ today, refreshKey }: { today: string; refreshKey: unknown }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ today, timeZone: currentBrowserTimeZone() });
    fetch(`/api/dashboard/overview?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Overview request failed");
        return response.json() as Promise<OverviewData>;
      })
      .then((overview) => {
        setData(overview);
        setError(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load Overview", reason);
        setData(null);
        setError(true);
      });
    return () => controller.abort();
  }, [today, refreshKey]);

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
        <NeedsAttentionPreview items={data?.staleApplications ?? []} loading={loading} error={error} />
        <UpcomingInterviewsPreview items={data?.upcomingInterviews.items ?? []} loading={loading} error={error} />
      </div>
    </section>
  );
}
