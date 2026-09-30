"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { DashboardMetricCard, formatDashboardPercentage } from "@/components/dashboard-metric-card";
import type { DashboardOverviewData as OverviewData, StaleApplication, StaleApplicationsData } from "@/types/dashboard";
import type { ApplicationRecord } from "@/types/application";
import { currentBrowserTimeZone, formatCalendarDate } from "@/lib/application-date";
import { applicationTableHref } from "@/lib/application-list";
import { revealDelay } from "@/lib/motion-mode";
import { BOARDS, boardLabel } from "@/lib/board-preferences";
import { useSettings } from "@/hooks/use-settings";
import { staleAgeLabel } from "@/lib/stale-label";
import { formatInterviewTime, INTERVIEW_TYPE_LABELS } from "@/lib/interviews";
import { useTimeFormat } from "@/hooks/use-time-format";

type Rate = OverviewData["interviewRate"];

function OverviewMetrics({ data }: { data: OverviewData | null }) {
  const rateCard = (label: string, rate: Rate | undefined, order: number) => (
    <DashboardMetricCard
      label={label}
      order={order}
      value={rate ? rate.percentage : "—"}
      format={formatDashboardPercentage}
      detail={rate ? `${rate.numerator} of ${rate.denominator}` : " "}
      coverage={rate?.historyCoverage}
      explanation="Percentage of applications that reached this exact status. Each status is counted independently."
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Overview metrics">
      <DashboardMetricCard label="Total applications" order={0} value={data?.totalApplications ?? "—"} detail="All time" href={applicationTableHref({ archived: "all" })} />
      <DashboardMetricCard label="Active pipeline" order={1} value={data?.activePipeline ?? "—"} detail="Currently active" href={applicationTableHref({ status: "active" })} />
      <DashboardMetricCard label="Upcoming interviews" order={2} value={data?.upcomingInterviews.count ?? "—"} href="/interviews" />
      {rateCard("Interview rate", data?.interviewRate, 3)}
      {rateCard("Offer rate", data?.offerRate, 4)}
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
      {/* As tall as the View all link, so both sections' dividers line up with or without it. */}
      <h2 className="flex min-h-7 min-w-0 items-center font-serif text-xl font-semibold leading-tight" id={id}>{title}</h2>
      {action}
    </div>
  );
}

/** List rows start rising this long after the page opens, just behind the metric cards. */
const ROW_REVEAL_START_MS = 180;

function NeedsAttentionRow({ item, application, reveal, archiveDisabled, onOpen, onArchive }: {
  item: StaleApplication;
  reveal: CSSProperties;
  application: ApplicationRecord | undefined;
  archiveDisabled: boolean;
  onOpen: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  return (
    <li className="attention-row motion-reveal relative min-w-0" style={reveal}>
      <button
        className="block w-full min-w-0 rounded-nook-sm px-2 py-4 text-left motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest disabled:hover:bg-transparent"
        disabled={!application}
        onClick={() => { if (application) onOpen(application); }}
        type="button"
      >
        <span className={`block text-xs font-semibold tracking-wide ${severityClass[item.severity]}`}>{item.severity}</span>
        {/* The title leaves room for Archive, which sits at the top right. */}
        <span className="mt-1 block break-words pr-20 text-sm font-semibold leading-5 text-ink">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></span>
        <span className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>{staleAgeLabel(item)}</span>
          <span>{boardLabel(BOARDS, item.status)}</span>
        </span>
      </button>
      {application && (
        <button
          className="attention-row-action btn-ghost absolute right-2 top-2.5 px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
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

function FollowUpRow({ item, application, reveal, busy, onOpen, onDone }: {
  item: OverviewData["followUps"][number];
  reveal: CSSProperties;
  application: ApplicationRecord | undefined;
  busy: boolean;
  onOpen: (application: ApplicationRecord) => void;
  onDone: (application: ApplicationRecord) => void;
}) {
  return (
    <li className="attention-row motion-reveal relative min-w-0" style={reveal}>
      <button
        className="block w-full min-w-0 rounded-nook-sm px-2 py-4 text-left motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest disabled:hover:bg-transparent"
        disabled={!application}
        onClick={() => { if (application) onOpen(application); }}
        type="button"
      >
        <span className="block text-xs font-semibold tracking-wide text-clay">FOLLOW UP</span>
        {/* The title leaves room for Done, which sits at the top right. */}
        <span className="mt-1 block break-words pr-20 text-sm font-semibold leading-5 text-ink">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></span>
        {item.followUpNote && <span className="mt-1 block break-words text-sm text-ink">{item.followUpNote}</span>}
        <span className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>{item.daysOverdue === 0 ? "Due today" : item.daysOverdue === 1 ? "Due yesterday" : `Due ${formatCalendarDate(item.followUpDate)} · ${item.daysOverdue} days overdue`}</span>
          <span>{boardLabel(BOARDS, item.status)}</span>
        </span>
      </button>
      {application && (
        <button
          aria-label={`Mark the follow-up for ${item.role} at ${item.company} done`}
          className="attention-row-action btn-ghost absolute right-2 top-2.5 px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
          disabled={busy}
          onClick={() => onDone(application)}
          type="button"
        >
          Done
        </button>
      )}
    </li>
  );
}

function NeedsAttention({ preview, followUps, full, rowRevealBase, loading, error, today, initiallyExpanded, applications, movingIds, onOpen, onArchive, onFollowUpDone }: {
  preview: OverviewData["staleApplications"];
  followUps: OverviewData["followUps"];
  /** Delay before the first row rises; see `ROW_REVEAL_START_MS`. */
  rowRevealBase: number;
  onFollowUpDone: (application: ApplicationRecord) => void;
  loading: boolean;
  error: boolean;
  today: string;
  /** The full stale list the app already loads, shown by View all. */
  full: { data: StaleApplicationsData | null; error: boolean };
  initiallyExpanded: boolean;
  applications: ApplicationRecord[];
  movingIds: ReadonlySet<string>;
  onOpen: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const fullItems = full.data
    ? [...full.data.applicationsBySeverity.CRITICAL, ...full.data.applicationsBySeverity.HIGH, ...full.data.applicationsBySeverity.MEDIUM]
      .filter((item) => applicationById.get(item.id)?.archived === false)
    : null;
  const items = expanded ? fullItems ?? [] : preview.filter((item) => applicationById.get(item.id)?.archived !== true);
  // Follow-ups come from Overview, so they show in both views; a reminder cleared here disappears at once.
  const dueFollowUps = followUps.filter((item) => {
    const application = applicationById.get(item.id);
    return application && !application.archived && application.followUpDate !== null && application.followUpDate.slice(0, 10) <= today;
  });
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
        title="Needs attention"
        action={(expanded || preview.length >= 3) && (
          <button aria-expanded={expanded} className={linkClass} onClick={toggle} type="button">
            {expanded ? "Show fewer" : <>View all <span aria-hidden="true">→</span></>}
          </button>
        )}
      />
      {expanded && <p className="mt-3 text-sm text-ink-soft">Active applications with no recent status change or interview, longest waiting first.</p>}
      {excluded > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          {excluded} active {excluded === 1 ? "application is" : "applications are"} not shown because reliable status timing is unavailable.
        </p>
      )}
      {listLoading ? (
        <p className="motion-reveal py-6 text-sm text-ink-soft" role={expanded ? "status" : undefined}>Loading applications…</p>
      ) : listError ? (
        <p className="motion-reveal py-6 text-sm text-ink-soft">{expanded ? "Needs attention could not be loaded. Please try again later." : "Preview unavailable."}</p>
      ) : items.length === 0 && dueFollowUps.length === 0 ? (
        <p className="motion-reveal py-6 text-sm text-ink-soft">{expanded ? "Nothing's gone quiet yet — good sign." : "No applications need attention right now."}</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {dueFollowUps.map((item, index) => (
            <FollowUpRow application={applicationById.get(item.id)} busy={movingIds.has(item.id)} item={item} key={`follow-up-${item.id}`} onDone={onFollowUpDone} onOpen={onOpen} reveal={revealDelay(index, { base: rowRevealBase })} />
          ))}
          {items.map((item, index) => (
            <NeedsAttentionRow application={applicationById.get(item.id)} archiveDisabled={movingIds.has(item.id)} item={item} key={item.id} onArchive={onArchive} onOpen={onOpen} reveal={revealDelay(dueFollowUps.length + index, { base: expanded ? 0 : rowRevealBase })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UpcomingInterviewsPreview({ items, rowRevealBase, loading, error, applications, onOpen }: {
  items: OverviewData["upcomingInterviews"]["items"];
  rowRevealBase: number;
  loading: boolean;
  error: boolean;
  applications: ApplicationRecord[];
  onOpen: (application: ApplicationRecord) => void;
}) {
  const timeFormat = useTimeFormat();
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  return (
    <section className="min-w-0" aria-labelledby="upcoming-preview-title">
      <PreviewHeading
        id="upcoming-preview-title"
        title="Upcoming interviews"
        action={<Link className={linkClass} href="/interviews">View all <span aria-hidden="true">→</span></Link>}
      />
      {loading ? (
        <p className="motion-reveal py-6 text-sm text-ink-soft">Loading interviews…</p>
      ) : error ? (
        <p className="motion-reveal py-6 text-sm text-ink-soft">Preview unavailable.</p>
      ) : items.length === 0 ? (
        <p className="motion-reveal py-6 text-sm text-ink-soft">All caught up — no interviews on the horizon.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {items.slice(0, 3).map((item, index) => {
            const application = applicationById.get(item.applicationId);
            // Rows match Needs attention: the same inset and hover, and they open the application.
            return (
              <li key={item.id} className="motion-reveal min-w-0" style={revealDelay(index, { base: rowRevealBase })}>
                <button
                  className="block w-full min-w-0 rounded-nook-sm px-2 py-4 text-left motion-interactive hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest disabled:hover:bg-transparent"
                  disabled={!application}
                  onClick={() => { if (application) onOpen(application); }}
                  type="button"
                >
                  <span className="block text-sm font-medium text-forest">{item.daysUntilInterview === 0 ? "Today" : item.daysUntilInterview === 1 ? "Tomorrow" : `In ${item.daysUntilInterview} days`}{item.time && `, ${formatInterviewTime(item.time, timeFormat)}`}<span className="font-normal text-ink-soft"> · {INTERVIEW_TYPE_LABELS[item.type]}</span></span>
                  <span className="mt-1 block break-words font-serif text-sm font-semibold leading-5 text-ink">{item.role} <span className="font-medium text-ink-soft">— {item.company}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function DashboardOverview({ today, refreshKey, stale, expandAttention, applications, movingIds, onOpen, onArchive, onFollowUpDone }: {
  today: string;
  refreshKey: unknown;
  stale: { data: StaleApplicationsData | null; error: boolean };
  expandAttention: boolean;
  applications: ApplicationRecord[];
  movingIds: ReadonlySet<string>;
  onOpen: (application: ApplicationRecord) => void;
  onArchive: (application: ApplicationRecord) => void;
  onFollowUpDone: (application: ApplicationRecord) => void;
}) {
  const staleApplicationThreshold = useSettings().staleApplicationThreshold;
  const [result, setResult] = useState<{ today: string; threshold: number; data: OverviewData; rowRevealBase: number } | null>(null);
  const [error, setError] = useState(false);
  const openedAt = useRef(0);

  useEffect(() => { openedAt.current = performance.now(); }, []);

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
        // Rows keep their place just behind the cards however long loading takes; late data doesn't wait again.
        const rowRevealBase = Math.max(0, Math.round(ROW_REVEAL_START_MS - (performance.now() - openedAt.current)));
        setResult({ today, threshold: staleApplicationThreshold, data: overview, rowRevealBase });
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
          followUps={data?.followUps ?? []}
          initiallyExpanded={expandAttention}
          loading={loading}
          movingIds={movingIds}
          onArchive={onArchive}
          onFollowUpDone={onFollowUpDone}
          onOpen={onOpen}
          preview={data?.staleApplications ?? []}
          rowRevealBase={result?.rowRevealBase ?? 0}
          full={stale}
          today={today}
        />
        <UpcomingInterviewsPreview applications={applications} rowRevealBase={result?.rowRevealBase ?? 0} error={error} items={data?.upcomingInterviews.items ?? []} loading={loading} onOpen={onOpen} />
      </div>
    </section>
  );
}
