"use client";

import { useEffect, useState } from "react";

import { DashboardMetricCard, formatDashboardPercentage } from "@/components/dashboard-metric-card";
import { analyticsCohortLabel, analyticsPeriodRange, type AnalyticsPeriod } from "@/lib/analytics-period";
import type { getDashboardAnalytics } from "@/lib/dashboard-analytics";
import { STATUS_META } from "@/lib/status-meta";

type AnalyticsData = Awaited<ReturnType<typeof getDashboardAnalytics>>;
type Rate = AnalyticsData["interviewRate"];

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "CURRENT_MONTH", label: "Current Month" },
  { value: "LAST_3_MONTHS", label: "Last 3 Months" },
  { value: "CURRENT_YEAR", label: "Current Year" },
  { value: "CUSTOM_MONTH", label: "Custom Month" },
  { value: "CUSTOM_YEAR", label: "Custom Year" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  .map((label, index) => ({ value: String(index + 1).padStart(2, "0"), label }));
const STATUSES = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"] as const;
const controlClass = "h-10 rounded-nook-sm border border-line bg-paper px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

function formatMonth(dateKey: string, length: "short" | "long") {
  return new Intl.DateTimeFormat(undefined, { month: length, timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00Z`));
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

function AnalyticsPeriodSelector({ period, month, year, onPeriodChange, onMonthChange, onYearChange }: {
  period: AnalyticsPeriod;
  month: string;
  year: string;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onMonthChange: (month: string) => void;
  onYearChange: (year: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-ink-soft">
        <span className="sr-only">Analytics period</span>
        <select aria-label="Analytics period" className={controlClass} onChange={(event) => onPeriodChange(event.target.value as AnalyticsPeriod)} value={period}>
          {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {period === "CUSTOM_MONTH" && (
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          <span>Month</span>
          <select className={controlClass} onChange={(event) => onMonthChange(event.target.value)} value={month}>
            {MONTHS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}
      {(period === "CUSTOM_MONTH" || period === "CUSTOM_YEAR") && (
        <label className="flex flex-col gap-1 text-xs text-ink-soft">
          <span>Year</span>
          <input className={`${controlClass} w-25`} inputMode="numeric" maxLength={4} onChange={(event) => onYearChange(event.target.value.replace(/\D/g, "").slice(0, 4))} pattern="[0-9]{4}" type="text" value={year} />
        </label>
      )}
    </div>
  );
}

function ApplicationsTrend({ trend }: { trend: AnalyticsData["applicationsTrend"] }) {
  const maxCount = Math.max(0, ...trend.buckets.map((bucket) => bucket.count));
  const scale = Math.max(1, maxCount);
  const hasData = maxCount > 0;
  return (
    <section className="min-w-0" aria-labelledby="applications-trend-heading">
      <div className="border-b border-line pb-3">
        <h2 className="font-serif text-xl font-semibold leading-tight" id="applications-trend-heading">Applications Trend</h2>
        <p className="mt-1 text-sm text-ink-soft">Applications submitted in this period</p>
      </div>
      <div className="mt-6 min-w-0" role={hasData ? "img" : undefined} aria-label={hasData ? `Applications submitted: ${trend.buckets.map((bucket, index) => `${trend.granularity === "WEEK" ? `Week ${index + 1}` : `${formatMonth(bucket.startDate, "long")} ${bucket.startDate.slice(0, 4)}`}, ${bucket.count}`).join("; ")}` : undefined}>
        <div className="relative h-44 border-b border-line">
          {!hasData && <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-ink-soft">No trend to show. Give it something to trend.</p>}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3].map((line) => <div className="border-t border-line/70" key={line} />)}
          </div>
          <div aria-hidden="true" className="relative flex h-full items-end gap-1 px-1 sm:gap-2">
            {trend.buckets.map((bucket) => (
              <div className="flex h-full min-w-0 flex-1 items-end justify-center" key={bucket.startDate}>
                <div className="w-full max-w-9 rounded-t-[3px] bg-forest" style={{ height: `${(bucket.count / scale) * 100}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden="true" className="flex gap-1 px-1 pt-2 sm:gap-2">
          {trend.buckets.map((bucket, index) => (
            <span className="min-w-0 flex-1 text-center text-[11px] text-ink-soft" key={bucket.startDate}>
              {trend.granularity === "WEEK" ? `W${index + 1}` : formatMonth(bucket.startDate, "short")}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusBreakdown({ counts }: { counts: AnalyticsData["statusBreakdown"] }) {
  const maxCount = Math.max(0, ...STATUSES.map((status) => counts[status]));
  return (
    <section className="min-w-0" aria-labelledby="status-breakdown-heading">
      <h2 className="border-b border-line pb-3 font-serif text-xl font-semibold leading-tight" id="status-breakdown-heading">Status Breakdown</h2>
      <ul className="mt-5 space-y-4">
        {STATUSES.map((status) => (
          <li key={status}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 font-medium text-ink">{status === "ONLINE_ASSESSMENT" ? "Online Assessment" : STATUS_META[status].label}</span>
              <span className="shrink-0 tabular-nums text-ink" aria-label={`${counts[status]} applications`}>{counts[status]}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-2 rounded-full bg-cream-2">
              <div className={`h-full rounded-full ${STATUS_META[status].dot}`} style={{ width: `${maxCount ? (counts[status] / maxCount) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardAnalytics({ today, refreshKey }: { today: string; refreshKey: unknown }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("CURRENT_MONTH");
  const [customMonth, setCustomMonth] = useState<string | null>(null);
  const [customYear, setCustomYear] = useState<string | null>(null);
  const month = customMonth ?? today.slice(5, 7);
  const year = customYear ?? today.slice(0, 4);
  const validYear = /^[0-9]{4}$/.test(year);
  const range = today && (period !== "CUSTOM_MONTH" && period !== "CUSTOM_YEAR" || validYear)
    ? analyticsPeriodRange({
      period,
      ...(period === "CUSTOM_MONTH" ? { month: `${year}-${month}` } : {}),
      ...(period === "CUSTOM_YEAR" ? { year: Number(year) } : {}),
    }, today)
    : null;
  const selectionKey = `${today}|${period}|${period === "CUSTOM_MONTH" ? month : ""}|${period === "CUSTOM_MONTH" || period === "CUSTOM_YEAR" ? year : ""}`;
  const [result, setResult] = useState<{ key: string; data: AnalyticsData } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!today || ((period === "CUSTOM_MONTH" || period === "CUSTOM_YEAR") && !validYear)) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ period, today });
    if (period === "CUSTOM_MONTH") query.set("month", `${year}-${month}`);
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
  }, [today, period, month, year, validYear, selectionKey, refreshKey]);

  const data = result?.key === selectionKey ? result.data : null;
  const error = failedKey === selectionKey;
  const invalidYear = (period === "CUSTOM_MONTH" || period === "CUSTOM_YEAR") && !validYear;
  const loading = !data && !error && !invalidYear;
  const rateCard = (label: string, rate: Rate | undefined) => (
    <DashboardMetricCard
      label={label}
      value={rate ? formatDashboardPercentage(rate.percentage) : "—"}
      detail={rate ? `${rate.numerator} of ${rate.denominator}` : " "}
      coverage={rate?.historyCoverage}
    />
  );

  return (
    <section className="@container w-full min-w-0 pb-10" aria-labelledby="analytics-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-serif text-[clamp(1.875rem,calc(1.65rem_+_0.15vw),2.125rem)] font-semibold leading-tight tracking-tight" id="analytics-heading">Analytics{range ? ` - ${analyticsCohortLabel(range, period, today.slice(0, 4))}` : ""}</h1>
        <AnalyticsPeriodSelector period={period} month={month} year={year} onPeriodChange={setPeriod} onMonthChange={setCustomMonth} onYearChange={setCustomYear} />
      </div>
      {invalidYear && <p className="mt-3 text-sm text-rose" role="status">Enter a four-digit year.</p>}
      {error && <p className="mt-4 rounded-nook-sm border border-rose bg-rose-tint px-4 py-3 text-sm text-ink" role="alert">Analytics could not be loaded. Please try another period or return later.</p>}
      {loading && <p className="sr-only" role="status">Loading Analytics</p>}
      <div className="mt-7 grid min-w-0 grid-cols-1 gap-3 @min-[520px]:grid-cols-2 @min-[850px]:grid-cols-4">
        <DashboardMetricCard label="Applications" value={data?.applications ?? "—"} detail={data ? periodLabel(data) : " "} />
        {rateCard("Interview Rate", data?.interviewRate)}
        {rateCard("Offer Rate", data?.offerRate)}
        {rateCard("Rejection Rate", data?.rejectionRate)}
      </div>
      <div className="mt-9 grid min-w-0 grid-cols-1 gap-x-8 gap-y-9 @min-[760px]:grid-cols-2">
        {data ? <ApplicationsTrend trend={data.applicationsTrend} /> : <div className="min-w-0"><h2 className="border-b border-line pb-3 font-serif text-xl font-semibold">Applications Trend</h2><p className="mt-1 text-sm text-ink-soft">Applications submitted in this period</p><div className="h-52" /></div>}
        {data ? <StatusBreakdown counts={data.statusBreakdown} /> : <div className="min-w-0"><h2 className="border-b border-line pb-3 font-serif text-xl font-semibold">Status Breakdown</h2><div className="h-52" /></div>}
      </div>
    </section>
  );
}
