import { Prisma, Status } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/calendar-date";
import {
  analyticsPeriodRange, dateFromParts, dateKey, monthEnd, monthParts, monthStart, shiftMonth,
  type AnalyticsSelection,
} from "@/lib/analytics-period";
import { analyzeStatusHistory, type StatusHistoryEvent } from "@/lib/status-history";

const ACTIVE_STATUSES = [Status.APPLIED, Status.ONLINE_ASSESSMENT, Status.INTERVIEW] as const;
const TERMINAL_INTERVIEW_STATUSES = [Status.OFFER, Status.REJECTED] as const;
const STALE_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM"] as const;

type DashboardApplication = {
  id: string;
  company: string;
  role: string;
  status: Status;
  archived: boolean;
  appliedDate: Date;
  interviewDate: Date | null;
  events: StatusHistoryEvent[];
};

type HistoryCoverage = {
  totalApplications: number;
  completeApplications: number;
  incompleteApplications: number;
  percentageComplete: number;
  isComplete: boolean;
};

type RateMetric = {
  numerator: number;
  denominator: number;
  percentage: number;
  historyCoverage: HistoryCoverage;
};

export type StaleApplication = {
  id: string;
  role: string;
  company: string;
  status: Status;
  lastStatusChangedAt: string;
  staleDays: number;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
};

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
  interviewDate: true,
  events: { select: eventSelection },
} as const;

function roundPercentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;
}

function coverageFor(applications: DashboardApplication[]): HistoryCoverage {
  const completeApplications = applications.filter((application) =>
    analyzeStatusHistory(application.status, application.events).complete,
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

function rateFor(applications: DashboardApplication[], milestone: Status): RateMetric {
  const numerator = applications.filter((application) =>
    analyzeStatusHistory(application.status, application.events).knownStatuses.has(milestone),
  ).length;
  return {
    numerator,
    denominator: applications.length,
    percentage: roundPercentage(numerator, applications.length),
    historyCoverage: coverageFor(applications),
  };
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return dateFromParts(year, month - 1, day);
}

function addDays(key: string, count: number) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKey(date);
}

function daysBetween(start: string, end: string) {
  return Math.round((dateFromKey(end).getTime() - dateFromKey(start).getTime()) / 86_400_000);
}

function makeTrendBuckets(selection: AnalyticsSelection, startDate: string, endDate: string) {
  const buckets: Array<{ startDate: string; endDate: string; count: number }> = [];
  if (selection.period === "CURRENT_MONTH" || selection.period === "CUSTOM_MONTH") {
    const { year, month } = monthParts(startDate);
    const lastDay = monthEnd(year, month);
    let start = monthStart(year, month);
    while (start <= lastDay) {
      const weekday = dateFromKey(start).getUTCDay();
      const daysUntilSunday = (7 - weekday) % 7;
      const end = [addDays(start, daysUntilSunday), lastDay].sort()[0];
      buckets.push({ startDate: start, endDate: end, count: 0 });
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

async function loadApplications(where?: Prisma.ApplicationWhereInput): Promise<DashboardApplication[]> {
  return prisma.application.findMany({
    where,
    select: baseSelection,
  });
}

function staleApplications(applications: DashboardApplication[], today: string, timeZone: string, threshold: number): StaleApplication[] {
  const result: StaleApplication[] = [];
  for (const application of applications) {
    if (application.archived || !ACTIVE_STATUSES.includes(application.status as typeof ACTIVE_STATUSES[number])) continue;
    const history = analyzeStatusHistory(application.status, application.events);
    const lastStatusEvent = history.latestStatusEvent;
    if (!lastStatusEvent) continue;

    const staleDays = Math.max(0, daysBetween(calendarDateInTimeZone(new Date(lastStatusEvent.createdAt), timeZone), today));
    if (staleDays < threshold) continue;
    const severity = staleDays >= 60 ? "CRITICAL" : staleDays >= 30 ? "HIGH" : "MEDIUM";
    result.push({
      id: application.id,
      role: application.role,
      company: application.company,
      status: application.status,
      lastStatusChangedAt: new Date(lastStatusEvent.createdAt).toISOString(),
      staleDays,
      severity,
    });
  }
  return result.sort((left, right) => {
    const severityOrder = STALE_SEVERITY_ORDER.indexOf(left.severity) - STALE_SEVERITY_ORDER.indexOf(right.severity);
    return severityOrder || left.lastStatusChangedAt.localeCompare(right.lastStatusChangedAt) || left.id.localeCompare(right.id);
  });
}

function staleTimingCoverage(applications: DashboardApplication[]) {
  const eligibleApplications = applications.filter((application) =>
    !application.archived && ACTIVE_STATUSES.includes(application.status as typeof ACTIVE_STATUSES[number]),
  );
  const withReliableStatusTimestamp = eligibleApplications.filter((application) =>
    analyzeStatusHistory(application.status, application.events).latestStatusEvent !== null,
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
    applications,
    top: applications.slice(0, 3),
  };
}

export async function getDashboardOverview(today: string, timeZone: string, staleApplicationThreshold = 15) {
  const applications = await loadApplications();
  const upcoming = applications
    .filter((application) =>
      !application.archived &&
      application.interviewDate !== null &&
      dateKey(application.interviewDate) >= today &&
      !TERMINAL_INTERVIEW_STATUSES.includes(application.status as typeof TERMINAL_INTERVIEW_STATUSES[number]),
    )
    .sort((left, right) =>
      dateKey(left.interviewDate!).localeCompare(dateKey(right.interviewDate!)) || left.id.localeCompare(right.id),
    );
  const stale = staleApplications(applications, today, timeZone, staleApplicationThreshold);

  return {
    totalApplications: applications.length,
    activePipeline: applications.filter((application) =>
      !application.archived && ACTIVE_STATUSES.includes(application.status as typeof ACTIVE_STATUSES[number]),
    ).length,
    upcomingInterviews: {
      count: upcoming.length,
      items: upcoming.slice(0, 3).map((application) => {
        const interviewDate = dateKey(application.interviewDate!);
        return {
          id: application.id,
          role: application.role,
          company: application.company,
          interviewDate,
          daysUntilInterview: daysBetween(today, interviewDate),
        };
      }),
    },
    interviewRate: rateFor(applications, Status.INTERVIEW),
    offerRate: rateFor(applications, Status.OFFER),
    staleApplications: stale.slice(0, 3),
    staleTimingCoverage: staleTimingCoverage(applications),
  };
}

export async function getStaleApplications(today: string, timeZone: string, staleApplicationThreshold = 15) {
  const applications = await loadApplications({
    archived: false,
    status: { in: [...ACTIVE_STATUSES] },
  });
  return {
    ...staleGroups(staleApplications(applications, today, timeZone, staleApplicationThreshold)),
    timingCoverage: staleTimingCoverage(applications),
  };
}

export async function getDashboardAnalytics(selection: AnalyticsSelection, today?: string) {
  const range = analyticsPeriodRange(selection, today);
  const applications = await loadApplications({
    appliedDate: {
      gte: dateFromKey(range.startDate),
      lt: dateFromKey(addDays(range.endDate, 1)),
    },
  });
  const trend = makeTrendBuckets(selection, range.startDate, range.endDate);
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
    interviewRate: rateFor(applications, Status.INTERVIEW),
    offerRate: rateFor(applications, Status.OFFER),
    rejectionRate: rateFor(applications, Status.REJECTED),
    statusBreakdown,
    applicationsTrend: trend,
  };
}
