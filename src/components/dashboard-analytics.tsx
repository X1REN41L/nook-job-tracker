"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DashboardMetricCard, formatDashboardPercentage } from "@/components/dashboard-metric-card";
import { analyticsBucketRange, analyticsCohortLabel, analyticsPeriodRange, type AnalyticsPeriod, type AnalyticsRange } from "@/lib/analytics-period";
import { applicationTableHref } from "@/lib/application-list";
import { revealDelay } from "@/lib/motion-mode";
import { useWeekStartDay } from "@/hooks/use-week-start-day";
import type { DashboardAnalyticsData as AnalyticsData } from "@/types/dashboard";
import { BOARDS, boardDot, boardLabel } from "@/lib/board-preferences";

type Rate = AnalyticsData["interviewRate"];

/** What the period covers; Month and Year then pick which one, newest first. */
type PeriodKind = "MONTH" | "LAST_3_MONTHS" | "YEAR";
const PERIOD_KINDS: { value: PeriodKind; label: string }[] = [
  { value: "MONTH", label: "Month" },
  { value: "LAST_3_MONTHS", label: "Last 3 months" },
  { value: "YEAR", label: "Year" },
];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Every month ("2026-09") from the first application's month through this one, newest first; this one reads "This month". */
function monthOptions(firstMonth: string | null, currentMonth: string) {
  const options: { value: string; label: string }[] = [];
  let year = Number(currentMonth.slice(0, 4));
  let month = Number(currentMonth.slice(5, 7));
  const first = firstMonth && firstMonth < currentMonth ? firstMonth : currentMonth;
  for (let value = currentMonth; value >= first; value = `${year}-${String(month).padStart(2, "0")}`) {
    options.push({ value, label: value === currentMonth ? "This month" : `${MONTH_NAMES[month - 1]} ${year}` });
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return options;
}

/** Every year from the first application's through this one, newest first; this one reads "This year". */
function yearOptions(firstMonth: string | null, currentYear: string) {
  const first = Math.min(Number((firstMonth ?? currentYear).slice(0, 4)), Number(currentYear));
  return Array.from({ length: Number(currentYear) - first + 1 }, (_, index) => {
    const value = String(Number(currentYear) - index);
    return { value, label: value === currentYear ? "This year" : value };
  });
}
const STATUSES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"] as const;
// Analytics counts archived applications too, so its links include them.
const rangeHref = (range: AnalyticsRange, status?: (typeof STATUSES)[number]) =>
  applicationTableHref({ archived: "all", appliedFrom: range.startDate, appliedTo: range.endDate, status });
const controlClass = "h-10 rounded-nook-sm border border-line bg-paper px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

function formatMonth(dateKey: string, length: "short" | "long") {
  return new Intl.DateTimeFormat(undefined, { month: length, timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
}

/** "Sep 7–13" for a week inside one month, "Aug 31 – Sep 6" across months. */
function formatWeekRange(startDate: string, endDate: string) {
  const format = (dateKey: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
  if (startDate === endDate) return format(startDate);
  return startDate.slice(0, 7) === endDate.slice(0, 7)
    ? `${format(startDate)}–${Number(endDate.slice(8, 10))}`
    : `${format(startDate)} – ${format(endDate)}`;
}

function formatDay(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
}

/** "Sep 1 – Sep 7", under each week's bar; a narrow chart wraps it after the dash. */
function formatAxisWeek(startDate: string, endDate: string) {
  return startDate === endDate ? formatDay(startDate) : `${formatDay(startDate)} – ${formatDay(endDate)}`;
}

function periodLabel(data: AnalyticsData) {
  const start = data.range.startDate;
  const end = data.range.endDate;
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  if (data.period === "CURRENT_YEAR" || data.period === "CUSTOM_YEAR") return startYear;
  if (data.period === "CURRENT_MONTH" || data.period === "CUSTOM_MONTH") return `${formatMonth(start, "long")} ${startYear}`;
  return startYear === endYear
    ? `${formatMonth(start, "short")} – ${formatMonth(end, "short")} ${endYear}`
    : `${formatMonth(start, "short")} ${startYear} – ${formatMonth(end, "short")} ${endYear}`;
}

function AnalyticsPeriodSelector({ kind, month, year, months, years, onKindChange, onMonthChange, onYearChange }: {
  kind: PeriodKind;
  month: string;
  year: string;
  months: { value: string; label: string }[];
  years: { value: string; label: string }[];
  onKindChange: (kind: PeriodKind) => void;
  onMonthChange: (month: string) => void;
  onYearChange: (year: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Analytics period" className={controlClass} onChange={(event) => onKindChange(event.target.value as PeriodKind)} value={kind}>
        {PERIOD_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {kind === "MONTH" && (
        <select aria-label="Month" className={controlClass} onChange={(event) => onMonthChange(event.target.value)} value={month}>
          {months.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
      {kind === "YEAR" && (
        <select aria-label="Year" className={controlClass} onChange={(event) => onYearChange(event.target.value)} value={year}>
          {years.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </div>
  );
}

/** Both Analytics sections share one heading shape, so their dividers and content line up side by side. */
function SectionHeading({ id, title, subtitle }: { id?: string; title: string; subtitle: string }) {
  return (
    <div className="border-b border-line pb-3">
      <h2 className="font-serif text-xl font-semibold leading-tight" id={id}>{title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>
    </div>
  );
}

const TREND_SUBTITLE = "Applications submitted in this period";
/** Each chart bar starts growing this long after the one before it. */
const BAR_STAGGER_MS = 60;
const BREAKDOWN_SUBTITLE = "Where this period's applications stand now";

/** Each bar opens the table for its own week or month within the Analytics period. */
function ApplicationsTrend({ range, trend, today }: { range: AnalyticsRange; trend: AnalyticsData["applicationsTrend"]; today: string }) {
  // Weeks or months that haven't started yet are empty for now, not slow; their labels dim so they don't read as zero.
  const upcoming = (bucket: { startDate: string }) => bucket.startDate > today;
  const maxCount = Math.max(0, ...trend.buckets.map((bucket) => bucket.count));
  const scale = Math.max(1, maxCount);
  const hasData = maxCount > 0;
  return (
    <section className="min-w-0" aria-labelledby="applications-trend-heading">
      <SectionHeading id="applications-trend-heading" subtitle={TREND_SUBTITLE} title="Applications trend" />
      <div className="mt-6 min-w-0">
        <div className="relative h-44 border-b border-line">
          {!hasData && <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-ink-soft">No trend to show. Give it something to trend.</p>}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3].map((line) => <div className="border-t border-line/70" key={line} />)}
          </div>
          <ul aria-label={hasData ? "Applications submitted" : undefined} aria-hidden={!hasData} className="relative flex h-full items-end gap-1 px-1 sm:gap-2">
            {trend.buckets.map((bucket, index) => {
              const period = trend.granularity === "WEEK"
                ? formatWeekRange(bucket.startDate, bucket.endDate)
                : `${formatMonth(bucket.startDate, "long")} ${bucket.startDate.slice(0, 4)}`;
              const label = upcoming(bucket) ? `${period}: not started yet` : `${period}: ${bucket.count} ${bucket.count === 1 ? "application" : "applications"}`;
              const bar = (
                <span className="motion-bar-grow-y relative block w-full max-w-9 rounded-t-[3px] bg-forest group-hover:bg-forest-deep" style={{ height: `${(bucket.count / scale) * 100}%`, animationDelay: `${index * BAR_STAGGER_MS}ms` }}>
                  {bucket.count > 0 && <span aria-hidden="true" className="absolute bottom-full left-1/2 -translate-x-1/2 pb-1 text-[11px] leading-none tabular-nums text-ink">{bucket.count}</span>}
                </span>
              );
              return (
                <li className="flex h-full min-w-0 flex-1 items-end justify-center" key={bucket.startDate}>
                  {bucket.count > 0 ? (
                    <Link aria-label={label} className="group flex h-full w-full items-end justify-center rounded-t-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" href={rangeHref(analyticsBucketRange(bucket, range))}>
                      {bar}
                    </Link>
                  ) : <span className="sr-only">{label}</span>}
                </li>
              );
            })}
          </ul>
        </div>
        <div aria-hidden="true" className="flex gap-1 px-1 pt-2 sm:gap-2">
          {trend.buckets.map((bucket) => (
            <span className={`min-w-0 flex-1 text-center text-[11px] leading-tight ${upcoming(bucket) ? "text-ink-soft/45" : "text-ink-soft"}`} key={bucket.startDate}>
              {trend.granularity === "WEEK" ? formatAxisWeek(bucket.startDate, bucket.endDate) : formatMonth(bucket.startDate, "short")}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusBreakdown({ counts, range }: { counts: AnalyticsData["statusBreakdown"]; range: AnalyticsRange }) {
  const maxCount = Math.max(0, ...STATUSES.map((status) => counts[status]));
  return (
    <section className="min-w-0" aria-labelledby="status-breakdown-heading">
      <SectionHeading id="status-breakdown-heading" subtitle={BREAKDOWN_SUBTITLE} title="Status breakdown" />
      <ul className="mt-6 space-y-4">
        {STATUSES.map((status, index) => (
          <li key={status}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {counts[status] > 0
                ? <Link className="min-w-0 rounded-nook-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" href={rangeHref(range, status)}>{boardLabel(BOARDS, status)}</Link>
                : <span className="min-w-0 font-medium text-ink">{boardLabel(BOARDS, status)}</span>}
              <span className="shrink-0 tabular-nums text-ink" aria-label={`${counts[status]} applications`}>{counts[status]}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-2 rounded-full bg-cream-2">
              <div className={`motion-bar-grow-x h-full rounded-full ${boardDot(BOARDS, status)}`} style={{ width: `${maxCount ? (counts[status] / maxCount) * 90 : 0}%`, animationDelay: `${index * BAR_STAGGER_MS}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardAnalytics({ today, firstMonth, refreshKey }: {
  today: string;
  /** The month ("2025-11") of the earliest application; the Month and Year menus reach back to it. */
  firstMonth: string | null;
  refreshKey: unknown;
}) {
  const [kind, setKind] = useState<PeriodKind>("MONTH");
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const currentMonth = today.slice(0, 7);
  const currentYear = today.slice(0, 4);
  const month = pickedMonth ?? currentMonth;
  const year = pickedYear ?? currentYear;
  // This month and this year run to today; any other month or year is complete.
  const period: AnalyticsPeriod = kind === "LAST_3_MONTHS" ? "LAST_3_MONTHS"
    : kind === "MONTH" ? (month === currentMonth ? "CURRENT_MONTH" : "CUSTOM_MONTH")
      : (year === currentYear ? "CURRENT_YEAR" : "CUSTOM_YEAR");
  const range = today
    ? analyticsPeriodRange({
      period,
      ...(period === "CUSTOM_MONTH" ? { month } : {}),
      ...(period === "CUSTOM_YEAR" ? { year: Number(year) } : {}),
    }, today)
    : null;
  // Month periods split into calendar weeks that start on the day chosen in Settings.
  const firstDay = useWeekStartDay();
  const selectionKey = `${today}|${period}|${period === "CUSTOM_MONTH" ? month : ""}|${period === "CUSTOM_YEAR" ? year : ""}|${firstDay}`;
  const [result, setResult] = useState<{ key: string; data: AnalyticsData } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!today) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ period, today, weekStart: String(firstDay) });
    if (period === "CUSTOM_MONTH") query.set("month", month);
    if (period === "CUSTOM_YEAR") query.set("year", year);
    fetch(`/api/dashboard/analytics?${query}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Analytics request failed");
        return response.json() as Promise<AnalyticsData>;
      })
      .then((data) => {
        setResult({ key: selectionKey, data });
        setFailedKey(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Could not load Analytics", reason);
        setFailedKey(selectionKey);
      });
    return () => controller.abort();
  }, [today, period, month, year, firstDay, selectionKey, refreshKey]);

  const data = result?.key === selectionKey ? result.data : null;
  const error = failedKey === selectionKey;
  const loading = !data && !error;
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
    <section className="@container w-full min-w-0 pb-10" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight" id="analytics-heading">Analytics{range ? ` — ${analyticsCohortLabel(range, period, today.slice(0, 4))}` : ""}</h1>
        {today && <AnalyticsPeriodSelector kind={kind} month={month} months={monthOptions(firstMonth, currentMonth)} onKindChange={setKind} onMonthChange={setPickedMonth} onYearChange={setPickedYear} year={year} years={yearOptions(firstMonth, currentYear)} />}
      </div>
      {error && <p className="mt-4 rounded-nook-sm border border-rose bg-rose-tint px-4 py-3 text-sm text-ink" role="alert">Analytics could not be loaded. Please try another period or return later.</p>}
      {loading && <p className="sr-only" role="status">Loading Analytics</p>}
      <div className="mt-7 grid min-w-0 grid-cols-1 gap-3 @min-[520px]:grid-cols-2 @min-[850px]:grid-cols-4">
        <DashboardMetricCard label="Applications" order={0} value={data?.applications ?? "—"} detail={data ? periodLabel(data) : " "} href={data ? rangeHref(data.range) : undefined} />
        {rateCard("Interview rate", data?.interviewRate, 1)}
        {rateCard("Offer rate", data?.offerRate, 2)}
        {rateCard("Rejection rate", data?.rejectionRate, 3)}
      </div>
      <div className="motion-reveal mt-9 grid min-w-0 grid-cols-1 gap-x-8 gap-y-9 @min-[760px]:grid-cols-2" style={revealDelay(4)}>
        {data ? <ApplicationsTrend range={data.range} today={today} trend={data.applicationsTrend} /> : <div className="min-w-0"><SectionHeading subtitle={TREND_SUBTITLE} title="Applications trend" /><div className="h-52" /></div>}
        {data ? <StatusBreakdown counts={data.statusBreakdown} range={data.range} /> : <div className="min-w-0"><SectionHeading subtitle={BREAKDOWN_SUBTITLE} title="Status breakdown" /><div className="h-52" /></div>}
      </div>
    </section>
  );
}
