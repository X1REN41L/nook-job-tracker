import type { InterviewType } from "@prisma/client";

import { hourCycleOption } from "@/lib/application-date";
import { addCalendarDays, startOfCalendarWeek } from "@/lib/calendar-date";
import type { TimeFormat } from "@/lib/settings-values";
import { isInProgressApplication } from "@/lib/status-values";
import type { ApplicationRecord } from "@/types/application";

export const INTERVIEW_TYPES = ["PHONE", "TECHNICAL", "ONSITE", "OTHER"] as const satisfies readonly InterviewType[];
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = { PHONE: "Phone", TECHNICAL: "Technical", ONSITE: "Onsite", OTHER: "Other" };

export type InterviewListItem = {
  id: string;
  applicationId: string;
  date: string;
  time: string | null;
  type: InterviewType;
  interviewers: string | null;
  role: string;
  company: string;
  note: string | null;
  /** Upcoming lists and counts include only rounds for applications still in progress. */
  inProgress: boolean;
};

export type InterviewGroup = {
  key: string;
  label: string;
  interviews: InterviewListItem[];
};

export function interviewDateKey(value: string) {
  return value.slice(0, 10);
}

type Schedulable = { id: string; date: string; time: string | null };

/** Date, then time (all-day rounds first), then ID. */
export function compareInterviews(left: Schedulable, right: Schedulable) {
  return interviewDateKey(left.date).localeCompare(interviewDateKey(right.date))
    || (left.time ?? "").localeCompare(right.time ?? "")
    || left.id.localeCompare(right.id);
}

/** The next round on or after today, or else the most recent one. */
export function featuredInterview<T extends Schedulable>(interviews: T[], today: string) {
  const sorted = [...interviews].sort(compareInterviews);
  return sorted.find((interview) => interviewDateKey(interview.date) >= today) ?? sorted.at(-1);
}

export function hasUpcomingInterview(application: Pick<ApplicationRecord, "interviews">, today: string) {
  return application.interviews.some((interview) => interviewDateKey(interview.date) >= today);
}

/** Formats a stored "HH:MM" time in the browser's locale. */
export function formatInterviewTime(time: string, timeFormat: TimeFormat = "system") {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC", ...hourCycleOption(timeFormat) }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

export function groupUpcomingInterviews(interviews: InterviewListItem[], today: string): InterviewGroup[] {
  const tomorrow = addCalendarDays(today, 1);
  const weekStart = startOfCalendarWeek(today);
  const thisWeekEnd = addCalendarDays(weekStart, 6);
  const nextWeekEnd = addCalendarDays(weekStart, 13);
  const groups: InterviewGroup[] = [
    { key: "today", label: "Today", interviews: [] },
    { key: "tomorrow", label: "Tomorrow", interviews: [] },
    { key: "later-this-week", label: "Later this week", interviews: [] },
    { key: "next-week", label: "Next week", interviews: [] },
    { key: "later", label: "Later", interviews: [] },
  ];

  for (const interview of interviews) {
    const date = interviewDateKey(interview.date);
    if (date < today) continue;
    const index = date === today ? 0
      : date === tomorrow ? 1
      : date <= thisWeekEnd ? 2
      : date <= nextWeekEnd ? 3
      : 4;
    groups[index].interviews.push(interview);
  }

  for (const group of groups) group.interviews.sort(compareInterviews);
  return groups.filter((group) => group.interviews.length > 0);
}

/** One list item per interview round. */
export function getInterviewListItems(applications: ApplicationRecord[]): InterviewListItem[] {
  return applications.flatMap((application) => application.interviews.map((interview) => ({
    id: interview.id,
    applicationId: application.id,
    date: interview.date,
    time: interview.time,
    type: interview.type,
    interviewers: interview.interviewers,
    role: application.role,
    company: application.company,
    note: interview.notes,
    inProgress: isInProgressApplication(application),
  })));
}

/** Counts upcoming rounds for applications still in progress, matching the Overview card. */
export function getUpcomingInterviewCount(applications: ApplicationRecord[], today: string) {
  return applications.filter(isInProgressApplication).reduce((count, application) =>
    count + application.interviews.filter((interview) => interviewDateKey(interview.date) >= today).length, 0);
}
