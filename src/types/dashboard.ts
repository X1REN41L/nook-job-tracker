import type { InterviewType, Status } from "@prisma/client";

import type { AnalyticsPeriod, AnalyticsRange } from "@/lib/analytics-period";

export type HistoryCoverage = {
  totalApplications: number;
  completeApplications: number;
  incompleteApplications: number;
  percentageComplete: number;
  isComplete: boolean;
};

export type RateMetric = {
  numerator: number;
  denominator: number;
  percentage: number;
  historyCoverage: HistoryCoverage;
};

export type StaleSeverity = "MEDIUM" | "HIGH" | "CRITICAL";

export type StaleApplication = {
  id: string;
  role: string;
  company: string;
  status: Status;
  lastStatusChangedAt: string;
  staleSince: "APPLIED_DATE" | "STATUS_CHANGE" | "INTERVIEW";
  staleDays: number;
  severity: StaleSeverity;
};

export type StaleTimingCoverage = {
  applicationsInScope: number;
  withReliableStatusTimestamp: number;
  withoutReliableStatusTimestamp: number;
  isComplete: boolean;
};

export type DashboardOverviewData = {
  totalApplications: number;
  activePipeline: number;
  upcomingInterviews: {
    count: number;
    items: Array<{
      id: string; applicationId: string; role: string; company: string;
      interviewDate: string; time: string | null; type: InterviewType; daysUntilInterview: number;
    }>;
  };
  /** Follow-up reminders due today or earlier, oldest first. */
  followUps: Array<{ id: string; role: string; company: string; status: Status; followUpDate: string; followUpNote: string | null; daysOverdue: number }>;
  interviewRate: RateMetric;
  offerRate: RateMetric;
  staleApplications: StaleApplication[];
  staleTimingCoverage: StaleTimingCoverage;
};

export type StaleApplicationsData = {
  /** Stale applications on the board; Needs attention lists these. */
  applicationsBySeverity: Record<StaleSeverity, StaleApplication[]>;
  /** Archived applications that had gone stale, so their tag stays wherever they are shown. */
  archived: StaleApplication[];
  counts: Record<StaleSeverity | "total", number>;
  timingCoverage: StaleTimingCoverage;
};

export type ApplicationsTrend = {
  granularity: "WEEK" | "MONTH";
  buckets: Array<{ startDate: string; endDate: string; count: number }>;
};

export type DashboardAnalyticsData = {
  period: AnalyticsPeriod;
  range: AnalyticsRange;
  applications: number;
  interviewRate: RateMetric;
  offerRate: RateMetric;
  rejectionRate: RateMetric;
  statusBreakdown: Record<Status, number>;
  applicationsTrend: ApplicationsTrend;
};
