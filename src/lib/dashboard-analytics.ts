import { InterviewType, Prisma, Status } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/calendar-date";
import {
  analyticsPeriodRange, dateFromParts, dateKey, monthEnd, monthParts, monthStart, shiftMonth,
  type AnalyticsSelection,
} from "@/lib/analytics-period";
import { analyzeStatusHistory, type StatusHistoryEvent } from "@/lib/status-history";
import { isUpcomingInterview } from "@/lib/interviews";
import { isInProgressApplication } from "@/lib/status-values";
import type {
  DashboardAnalyticsData, DashboardOverviewData, HistoryCoverage, RateMetric, StaleApplication, StaleApplicationsData,
  StaleTimingCoverage,
} from "@/types/dashboard";

const ACTIVE_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW] as const;
const STALE_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM"] as const;
const STALE_CRITICAL_DAYS = 60;
const STALE_HIGH_DAYS = 30;

type DashboardApplication = {
  id: string;
  company: string;
  role: string;
  status: Status;
  archived: boolean;
  appliedDate: Date;
  followUpDate: Date | null;
  followUpNote: string | null;
  interviews: Array<{ id: string; date: Date; time: string | null; type: InterviewType }>;
  events: StatusHistoryEvent[];
};
type AnalyzedApplication = DashboardApplication & { history: ReturnType<typeof analyzeStatusHistory> };

const eventSelection = {
  id: true,
  type: true,
  fromStatus: true,
  toStatus: true,
  detail: true,
  createdAt: true,
} as const;

const baseSelection = {
  id: true,
  company: true,
  role: true,
  status: true,
  archived: true,
  appliedDate: true,
  followUpDate: true,
  followUpNote: true,
  interviews: { select: { id: true, date: true, time: true, type: true } },
  events: { select: eventSelection },
} as const;

function roundPercentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;
}

function coverageFor(applications: AnalyzedApplication[]): HistoryCoverage {
  const completeApplications = applications.filter((application) =>
    application.history.complete,
  ).length;
  const denominator = applications.length;
  return {
    totalApplications: denominator,
    completeApplications,
    incompleteApplications: denominator - completeApplications,
    percentageComplete: roundPercentage(completeApplications, denominator),
    isComplete: completeApplications === denominator,
  };
}

function rateFor(applications: AnalyzedApplication[], milestone: Status, historyCoverage: HistoryCoverage): RateMetric {
  const numerator = applications.filter((application) =>
    application.history.knownStatuses.has(milestone),
  ).length;
  return {
    numerator,
    denominator: applications.length,
    percentage: roundPercentage(numerator, applications.length),
    historyCoverage,
  };
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

async function loadApplications(where?: Prisma.ApplicationWhereInput): Promise<AnalyzedApplication[]> {
  const applications = await prisma.application.findMany({
    where,
    select: baseSelection,
  });
  return applications.map((application) => ({
    ...application,
    history: analyzeStatusHistory(application.status, application.events),
  }));
}

/** Stale applications still on the board, or with `archived`, the archived ones that went stale the same way. */
function staleApplications(applications: AnalyzedApplication[], today: string, timeZone: string, threshold: number, archived = false): StaleApplication[] {
  const result: StaleApplication[] = [];
  for (const application of applications) {
    if (application.archived !== archived || !ACTIVE_STATUSES.includes(application.status as typeof ACTIVE_STATUSES[number])) continue;
    const lastStatusEvent = application.history.latestStatusEvent;
    if (!lastStatusEvent) continue;

    // A booked interview means the application is moving, so it is not waiting on anything.
    const interviewDates = application.interviews.map((interview) => dateKey(interview.date));
    if (interviewDates.some((date) => date >= today)) continue;

    const statusChangedOn = calendarDateInTimeZone(new Date(lastStatusEvent.createdAt), timeZone);
    // An application that never changed status has waited since it was applied, even when it was entered later.
    const appliedOn = dateKey(application.appliedDate);
    const statusSince = lastStatusEvent.fromStatus === null && appliedOn < statusChangedOn ? "APPLIED_DATE" : "STATUS_CHANGE";
    const statusSinceOn = statusSince === "APPLIED_DATE" ? appliedOn : statusChangedOn;
    // A past interview is activity too, so the wait restarts from the latest one.
    const lastInterviewOn = interviewDates.reduce((latest, date) => (date > latest ? date : latest), "");
    const staleSince = lastInterviewOn > statusSinceOn ? "INTERVIEW" : statusSince;
    const staleDays = Math.max(0, daysBetween(staleSince === "INTERVIEW" ? lastInterviewOn : statusSinceOn, today));
    if (staleDays < threshold) continue;
    const severity = staleDays >= STALE_CRITICAL_DAYS ? "CRITICAL" : staleDays >= STALE_HIGH_DAYS ? "HIGH" : "MEDIUM";
    result.push({
      id: application.id,
      role: application.role,
      company: application.company,
      status: application.status,
      lastStatusChangedAt: new Date(lastStatusEvent.createdAt).toISOString(),
      staleSince,
      staleDays,
      severity,
    });
  }
  return result.sort((left, right) => {
    const severityOrder = STALE_SEVERITY_ORDER.indexOf(left.severity) - STALE_SEVERITY_ORDER.indexOf(right.severity);
    return severityOrder || right.staleDays - left.staleDays
      || left.lastStatusChangedAt.localeCompare(right.lastStatusChangedAt) || left.id.localeCompare(right.id);
  });
}

function staleTimingCoverage(applications: AnalyzedApplication[]): StaleTimingCoverage {
  const eligibleApplications = applications.filter((application) =>
    !application.archived && ACTIVE_STATUSES.includes(application.status as typeof ACTIVE_STATUSES[number]),
  );
  const withReliableStatusTimestamp = eligibleApplications.filter((application) =>
    application.history.latestStatusEvent !== null,
  ).length;
  const withoutReliableStatusTimestamp = eligibleApplications.length - withReliableStatusTimestamp;
  return {
    applicationsInScope: eligibleApplications.length,
    withReliableStatusTimestamp,
    withoutReliableStatusTimestamp,
    isComplete: withoutReliableStatusTimestamp === 0,
  };
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

/** `now` is the user's local "YYYY-MM-DDTHH:MM"; see `isUpcomingInterview`. */
export async function getDashboardOverview(now: string, timeZone: string, staleApplicationThreshold = 15): Promise<DashboardOverviewData> {
  const today = now.slice(0, 10);
  const applications = await loadApplications();
  const historyCoverage = coverageFor(applications);
  // Each interview round counts separately, for applications still in progress.
  const upcoming = applications
    .filter(isInProgressApplication)
    .flatMap((application) => application.interviews
      .filter((interview) => isUpcomingInterview({ date: dateKey(interview.date), time: interview.time }, now))
      .map((interview) => ({ application, interview, date: dateKey(interview.date) })))
    .sort((left, right) =>
      left.date.localeCompare(right.date) || (left.interview.time ?? "").localeCompare(right.interview.time ?? "") || left.interview.id.localeCompare(right.interview.id),
    );
  const followUps = applications
    .filter((application) => !application.archived && application.followUpDate !== null && dateKey(application.followUpDate) <= today)
    .map((application) => ({
      id: application.id,
      role: application.role,
      company: application.company,
      status: application.status,
      followUpDate: dateKey(application.followUpDate!),
      followUpNote: application.followUpNote,
      daysOverdue: daysBetween(dateKey(application.followUpDate!), today),
    }))
    .sort((left, right) => left.followUpDate.localeCompare(right.followUpDate) || left.id.localeCompare(right.id));
  const stale = staleApplications(applications, today, timeZone, staleApplicationThreshold);

  return {
    totalApplications: applications.length,
    activePipeline: applications.filter((application) =>
      !application.archived && ACTIVE_STATUSES.includes(application.status as typeof ACTIVE_STATUSES[number]),
    ).length,
    upcomingInterviews: {
      count: upcoming.length,
      items: upcoming.slice(0, 3).map(({ application, interview, date }) => ({
        id: interview.id,
        applicationId: application.id,
        role: application.role,
        company: application.company,
        interviewDate: date,
        time: interview.time,
        type: interview.type,
        daysUntilInterview: daysBetween(today, date),
      })),
    },
    followUps,
    interviewRate: rateFor(applications, Status.INTERVIEW, historyCoverage),
    offerRate: rateFor(applications, Status.OFFER, historyCoverage),
    staleApplications: stale.slice(0, 3),
    staleTimingCoverage: staleTimingCoverage(applications),
  };
}

export async function getStaleApplications(today: string, timeZone: string, staleApplicationThreshold = 15): Promise<StaleApplicationsData> {
  const applications = await loadApplications({
    status: { in: [...ACTIVE_STATUSES] },
  });
  return {
    ...staleGroups(staleApplications(applications, today, timeZone, staleApplicationThreshold)),
    archived: staleApplications(applications, today, timeZone, staleApplicationThreshold, true),
    timingCoverage: staleTimingCoverage(applications),
  };
}

/** `firstDay` starts the weekly bars of month periods, counted from Sunday (0); Monday by default. */
export async function getDashboardAnalytics(selection: AnalyticsSelection, today?: string, firstDay = 1): Promise<DashboardAnalyticsData> {
  const range = analyticsPeriodRange(selection, today);
  const applications = await loadApplications({
    appliedDate: range.endDate === "9999-12-31"
      ? { gte: dateFromKey(range.startDate), lte: new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999)) }
      : { gte: dateFromKey(range.startDate), lt: dayAfterKey(range.endDate) },
  });
  const historyCoverage = coverageFor(applications);
  const trend = makeTrendBuckets(selection, range.startDate, range.endDate, firstDay);
  const bucketsByKey = new Map(trend.buckets.map((bucket) => [bucket.startDate, bucket]));
  const statusBreakdown: Record<Status, number> = {
    APPLIED: 0,
    ONLINE_ASSESSMENT: 0,
    INTERVIEW: 0,
    OFFER: 0,
    REJECTED: 0,
  };

  for (const application of applications) {
    statusBreakdown[application.status] += 1;
    const appliedDate = dateKey(application.appliedDate);
    const bucket = trend.granularity === "WEEK"
      ? trend.buckets.find((item) => appliedDate >= item.startDate && appliedDate <= item.endDate)
      : bucketsByKey.get(`${appliedDate.slice(0, 7)}-01`);
    if (bucket) bucket.count += 1;
  }

  return {
    period: selection.period,
    range,
    applications: applications.length,
    interviewRate: rateFor(applications, Status.INTERVIEW, historyCoverage),
    offerRate: rateFor(applications, Status.OFFER, historyCoverage),
    rejectionRate: rateFor(applications, Status.REJECTED, historyCoverage),
    statusBreakdown,
    applicationsTrend: trend,
  };
}
