import { Prisma, Status } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/calendar-date";
import {
  analyticsPeriodRange, dateFromParts, dateKey, monthEnd, monthParts, monthStart, shiftMonth,
  type AnalyticsSelection,
} from "@/lib/analytics-period";
import type {
  DashboardAnalyticsData, DashboardOverviewData, HistoryCoverage, RateMetric, StaleApplication, StaleApplicationsData,
  StaleTimingCoverage,
} from "@/types/dashboard";

const ACTIVE_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW] as const;
const STALE_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM"] as const;
const STALE_CRITICAL_DAYS = 60;
const STALE_HIGH_DAYS = 30;

function roundPercentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;
}

/** Windowed history validation preserves typed transitions, timestamp ties, and incomplete legacy history. */
async function historyMetrics(scope = Prisma.sql`1 = 1`) {
  const [row] = await prisma.$queryRaw<Array<{ total: bigint; complete: bigint | null; interview: bigint | null; offer: bigint | null; rejected: bigint | null }>>(Prisma.sql`
    WITH scoped AS (SELECT id, status FROM Application a WHERE ${scope}),
    ordered AS (
      SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.applicationId ORDER BY e.createdAt, e.id) AS position,
        LAG(toStatus) OVER (PARTITION BY e.applicationId ORDER BY e.createdAt, e.id) AS previousStatus,
        LAG(createdAt) OVER (PARTITION BY e.applicationId ORDER BY e.createdAt, e.id) AS previousTime,
        ROW_NUMBER() OVER (PARTITION BY e.applicationId ORDER BY e.createdAt DESC, e.id DESC) AS reversePosition
      FROM ApplicationEvent e JOIN scoped a ON a.id = e.applicationId WHERE e.type = 'STATUS_CHANGE'
    ), history AS (
      SELECT applicationId, COUNT(*) AS n,
        SUM(CASE WHEN toStatus IS NULL OR fromStatus = toStatus OR previousTime = createdAt
          OR (position = 1 AND fromStatus IS NOT NULL)
          OR (position > 1 AND (fromStatus IS NULL OR fromStatus IS NOT previousStatus)) THEN 1 ELSE 0 END) AS invalid,
        MAX(CASE WHEN reversePosition = 1 THEN toStatus END) AS finalStatus,
        MAX(CASE WHEN toStatus IS NOT NULL AND fromStatus IS NOT toStatus AND (fromStatus = 'INTERVIEW' OR toStatus = 'INTERVIEW') THEN 1 ELSE 0 END) AS interview,
        MAX(CASE WHEN toStatus IS NOT NULL AND fromStatus IS NOT toStatus AND (fromStatus = 'OFFER' OR toStatus = 'OFFER') THEN 1 ELSE 0 END) AS offer,
        MAX(CASE WHEN toStatus IS NOT NULL AND fromStatus IS NOT toStatus AND (fromStatus = 'REJECTED' OR toStatus = 'REJECTED') THEN 1 ELSE 0 END) AS rejected
      FROM ordered GROUP BY applicationId
    )
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN h.n > 0 AND h.invalid = 0 AND h.finalStatus = a.status THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN a.status = 'INTERVIEW' OR h.interview = 1 THEN 1 ELSE 0 END) AS interview,
      SUM(CASE WHEN a.status = 'OFFER' OR h.offer = 1 THEN 1 ELSE 0 END) AS offer,
      SUM(CASE WHEN a.status = 'REJECTED' OR h.rejected = 1 THEN 1 ELSE 0 END) AS rejected
    FROM scoped a LEFT JOIN history h ON h.applicationId = a.id
  `);
  const total = Number(row.total);
  const complete = Number(row.complete ?? 0);
  const coverage: HistoryCoverage = { totalApplications: total, completeApplications: complete,
    incompleteApplications: total - complete, percentageComplete: roundPercentage(complete, total), isComplete: total === complete };
  const rate = (value: bigint | null): RateMetric => ({ numerator: Number(value ?? 0), denominator: total,
    percentage: roundPercentage(Number(value ?? 0), total), historyCoverage: coverage });
  return { total, interview: rate(row.interview), offer: rate(row.offer), rejected: rate(row.rejected) };
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return dateFromParts(year, month - 1, day);
}

function dayAfterKey(key: string) {
  const end = dateFromKey(key);
  const year = end.getUTCFullYear();
  // Date.UTC treats 0-99 as 1900-1999; dateFromParts handles those years.
  return year < 100
    ? dateFromParts(year, end.getUTCMonth(), end.getUTCDate() + 1)
    : new Date(Date.UTC(year, end.getUTCMonth(), end.getUTCDate() + 1));
}

function addDays(key: string, count: number) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKey(date);
}

function daysBetween(start: string, end: string) {
  return Math.round((dateFromKey(end).getTime() - dateFromKey(start).getTime()) / 86_400_000);
}

function makeTrendBuckets(selection: AnalyticsSelection, startDate: string, endDate: string, firstDay: number) {
  const buckets: Array<{ startDate: string; endDate: string; count: number }> = [];
  if (selection.period === "CURRENT_MONTH" || selection.period === "CUSTOM_MONTH") {
    // Calendar weeks starting on `firstDay` (0 is Sunday), cut to the month, so the first and last can be short.
    const { year, month } = monthParts(startDate);
    const lastDay = monthEnd(year, month);
    // Stops at the month's last day without stepping past it, which for December 9999 would leave the calendar.
    let start = monthStart(year, month);
    for (;;) {
      // Days left in this week, from the weekday alone, so no date outside the month (or the calendar) is ever built.
      const daysLeft = 6 - ((dateFromKey(start).getUTCDay() - firstDay + 7) % 7);
      const end = Number(start.slice(8, 10)) + daysLeft < Number(lastDay.slice(8, 10)) ? addDays(start, daysLeft) : lastDay;
      buckets.push({ startDate: start, endDate: end, count: 0 });
      if (end === lastDay) break;
      start = addDays(end, 1);
    }
    return { granularity: "WEEK" as const, buckets };
  }

  const first = monthParts(startDate);
  const last = monthParts(endDate);
  let cursor = first;
  while (cursor.year < last.year || (cursor.year === last.year && cursor.month <= last.month)) {
    buckets.push({
      startDate: monthStart(cursor.year, cursor.month),
      endDate: monthEnd(cursor.year, cursor.month),
      count: 0,
    });
    cursor = shiftMonth(cursor.year, cursor.month, 1);
  }
  return { granularity: "MONTH" as const, buckets };
}

type StaleRow = { id: string; company: string; role: string; status: Status; archived: boolean;
  appliedDate: Date; statusAt: Date | null; fromStatus: Status | null; lastInterview: Date | null; upcoming: bigint };

async function staleData(today: string, timeZone: string, threshold: number) {
  const active: StaleApplication[] = [];
  const archived: StaleApplication[] = [];
  let applicationsInScope = 0;
  let withReliableStatusTimestamp = 0;
  let after = "";
  for (;;) {
    // Only the latest timestamp group and interview extrema are needed; never load whole child arrays.
    const page = await prisma.$queryRaw<StaleRow[]>(Prisma.sql`
      SELECT a.id, a.company, a.role, a.status, a.archived, a.appliedDate, e.createdAt AS statusAt, e.fromStatus,
        li.date AS lastInterview,
        (SELECT COUNT(*) FROM Interview i WHERE i.applicationId = a.id AND i.date >= ${dateFromKey(today)}) AS upcoming
      FROM Application a LEFT JOIN ApplicationEvent e ON e.id = (
        SELECT x.id FROM ApplicationEvent x WHERE x.applicationId = a.id AND x.type = 'STATUS_CHANGE'
          AND x.toStatus = a.status
          AND x.createdAt = (SELECT MAX(createdAt) FROM ApplicationEvent WHERE applicationId = a.id AND type = 'STATUS_CHANGE')
          AND NOT EXISTS (SELECT 1 FROM ApplicationEvent bad WHERE bad.applicationId = a.id AND bad.type = 'STATUS_CHANGE'
            AND bad.createdAt = x.createdAt AND (bad.toStatus IS NULL OR bad.fromStatus = bad.toStatus))
        ORDER BY x.id LIMIT 1
      )
      -- A joined column keeps Prisma's DateTime decoding; a bare MAX() expression does not.
      LEFT JOIN Interview li ON li.id = (
        SELECT i.id FROM Interview i WHERE i.applicationId = a.id ORDER BY i.date DESC, i.id DESC LIMIT 1
      )
      WHERE a.id > ${after} AND a.status IN ('APPLIED', 'ONLINE_ASSESSMENT', 'INTERVIEW') ORDER BY a.id LIMIT 200
    `);
    for (const application of page) {
      if (!application.archived) {
        applicationsInScope++;
        if (application.statusAt) withReliableStatusTimestamp++;
      }
      if (!application.statusAt || Number(application.upcoming) > 0) continue;
      const statusChangedOn = calendarDateInTimeZone(new Date(application.statusAt), timeZone);
      const appliedOn = dateKey(application.appliedDate);
      const statusSince = application.fromStatus === null && appliedOn < statusChangedOn ? "APPLIED_DATE" : "STATUS_CHANGE";
      const statusSinceOn = statusSince === "APPLIED_DATE" ? appliedOn : statusChangedOn;
      const lastInterviewOn = application.lastInterview ? dateKey(new Date(application.lastInterview)) : "";
      const staleSince = lastInterviewOn > statusSinceOn ? "INTERVIEW" : statusSince;
      const staleDays = Math.max(0, daysBetween(staleSince === "INTERVIEW" ? lastInterviewOn : statusSinceOn, today));
      if (staleDays < threshold) continue;
      const severity = staleDays >= STALE_CRITICAL_DAYS ? "CRITICAL" : staleDays >= STALE_HIGH_DAYS ? "HIGH" : "MEDIUM";
      (application.archived ? archived : active).push({ id: application.id, company: application.company, role: application.role,
        status: application.status, lastStatusChangedAt: new Date(application.statusAt).toISOString(), staleSince, staleDays, severity });
    }
    if (page.length < 200) break;
    after = page.at(-1)!.id;
  }
  const sort = (rows: StaleApplication[]) => rows.sort((a, b) => STALE_SEVERITY_ORDER.indexOf(a.severity) - STALE_SEVERITY_ORDER.indexOf(b.severity)
    || b.staleDays - a.staleDays || a.lastStatusChangedAt.localeCompare(b.lastStatusChangedAt) || a.id.localeCompare(b.id));
  const timingCoverage: StaleTimingCoverage = { applicationsInScope, withReliableStatusTimestamp,
    withoutReliableStatusTimestamp: applicationsInScope - withReliableStatusTimestamp,
    isComplete: applicationsInScope === withReliableStatusTimestamp };
  return { active: sort(active), archived: sort(archived), timingCoverage };
}

function staleGroups(applications: StaleApplication[]) {
  const applicationsBySeverity = {
    CRITICAL: applications.filter((application) => application.severity === "CRITICAL"),
    HIGH: applications.filter((application) => application.severity === "HIGH"),
    MEDIUM: applications.filter((application) => application.severity === "MEDIUM"),
  };
  return {
    applicationsBySeverity,
    counts: {
      CRITICAL: applicationsBySeverity.CRITICAL.length,
      HIGH: applicationsBySeverity.HIGH.length,
      MEDIUM: applicationsBySeverity.MEDIUM.length,
      total: applications.length,
    },
  };
}

/** `now` is the user's local calendar date and time. Follow-ups use bounded API pages. */
export async function getDashboardOverview(now: string, timeZone: string, staleApplicationThreshold = 15, offset = 0): Promise<DashboardOverviewData> {
  const today = now.slice(0, 10);
  const metrics = await historyMetrics();
  const activePipeline = await prisma.application.count({ where: { archived: false, status: { in: [...ACTIVE_STATUSES] } } });
  const minute = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16));
  const upcomingWhere: Prisma.InterviewWhereInput = {
    application: { archived: false, status: { in: [...ACTIVE_STATUSES] } },
    OR: [{ date: { gt: dateFromKey(today) } }, { date: dateFromKey(today), OR: [{ time: null }, ...(minute < 60 ? [{ time: { not: null } }] : [{ time: { gt: `${String(Math.floor((minute - 60) / 60)).padStart(2, "0")}:${String((minute - 60) % 60).padStart(2, "0")}` } }])] }],
  };
  const count = await prisma.interview.count({ where: upcomingWhere });
  const upcoming = await prisma.interview.findMany({ where: upcomingWhere, orderBy: [{ date: "asc" }, { time: "asc" }, { id: "asc" }], take: 3,
    select: { id: true, date: true, time: true, type: true, application: { select: { id: true, role: true, company: true } } } });
  const followUps = await prisma.application.findMany({ where: { archived: false, followUpDate: { lte: dateFromKey(today) } },
    orderBy: [{ followUpDate: "asc" }, { id: "asc" }], skip: offset, take: 200,
    select: { id: true, role: true, company: true, status: true, followUpDate: true, followUpNote: true } });
  const stale = await staleData(today, timeZone, staleApplicationThreshold);
  return { totalApplications: metrics.total, activePipeline,
    upcomingInterviews: { count, items: upcoming.map(({ application, ...interview }) => ({ id: interview.id, applicationId: application.id,
      role: application.role, company: application.company, interviewDate: dateKey(interview.date), time: interview.time,
      type: interview.type, daysUntilInterview: daysBetween(today, dateKey(interview.date)) })) },
    followUps: followUps.map((application) => ({ ...application, followUpDate: dateKey(application.followUpDate!), daysOverdue: daysBetween(dateKey(application.followUpDate!), today) })),
    interviewRate: metrics.interview, offerRate: metrics.offer, staleApplications: stale.active.slice(0, 3), staleTimingCoverage: stale.timingCoverage };
}

export async function getStaleApplications(today: string, timeZone: string, staleApplicationThreshold = 15, offset = 0): Promise<StaleApplicationsData> {
  const stale = await staleData(today, timeZone, staleApplicationThreshold);
  const groups = staleGroups(stale.active);
  return { ...groups, applicationsBySeverity: {
    CRITICAL: groups.applicationsBySeverity.CRITICAL.slice(offset, offset + 200),
    HIGH: groups.applicationsBySeverity.HIGH.slice(offset, offset + 200),
    MEDIUM: groups.applicationsBySeverity.MEDIUM.slice(offset, offset + 200),
  }, archived: stale.archived.slice(offset, offset + 200), timingCoverage: stale.timingCoverage };
}

export async function getDashboardAnalytics(selection: AnalyticsSelection, today?: string, firstDay = 1): Promise<DashboardAnalyticsData> {
  const range = analyticsPeriodRange(selection, today);
  const end = range.endDate === "9999-12-31" ? new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999)) : dayAfterKey(range.endDate);
  const appliedDate = range.endDate === "9999-12-31" ? { gte: dateFromKey(range.startDate), lte: end } : { gte: dateFromKey(range.startDate), lt: end };
  const metrics = await historyMetrics(Prisma.sql`a.appliedDate >= ${dateFromKey(range.startDate)} AND a.appliedDate ${range.endDate === "9999-12-31" ? Prisma.sql`<=` : Prisma.sql`<`} ${end}`);
  const trend = makeTrendBuckets(selection, range.startDate, range.endDate, firstDay);
  const statusBreakdown: Record<Status, number> = { APPLIED: 0, ONLINE_ASSESSMENT: 0, INTERVIEW: 0, OFFER: 0, REJECTED: 0 };
  const grouped = await prisma.application.groupBy({ by: ["status"], where: { appliedDate }, _count: true });
  for (const row of grouped) statusBreakdown[row.status] = row._count;
  for (const bucket of trend.buckets) {
    const start = bucket.startDate < range.startDate ? range.startDate : bucket.startDate;
    const finish = bucket.endDate > range.endDate ? range.endDate : bucket.endDate;
    bucket.count = await prisma.application.count({ where: { appliedDate: finish === "9999-12-31"
      ? { gte: dateFromKey(start), lte: end } : { gte: dateFromKey(start), lt: dayAfterKey(finish) } } });
  }
  return { period: selection.period, range, applications: metrics.total, interviewRate: metrics.interview,
    offerRate: metrics.offer, rejectionRate: metrics.rejected, statusBreakdown, applicationsTrend: trend };
}
