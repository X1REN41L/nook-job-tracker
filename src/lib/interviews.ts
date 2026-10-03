import type { InterviewType } from "@prisma/client";

import { hourCycleOption } from "@/lib/application-date";
import { addCalendarDays, startOfCalendarWeek } from "@/lib/calendar-date";
import type { TimeFormat } from "@/lib/settings-values";
import { isInProgressApplication } from "@/lib/status-values";
import type { ApplicationSummary } from "@/types/application";

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

type InterviewGroup = {
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

// Rounds have no end time, so a timed round counts as upcoming until this long after it starts.
const INTERVIEW_UPCOMING_MINUTES = 60;

function minutesOf(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * `now` is the local "YYYY-MM-DDTHH:MM" (see `currentLocalMinute`). A timed round today stays
 * upcoming for an hour after it starts; an all-day round stays upcoming until the day ends.
 */
export function isUpcomingInterview(interview: Pick<Schedulable, "date" | "time">, now: string) {
  const date = interviewDateKey(interview.date);
  const today = now.slice(0, 10);
  if (date !== today) return date > today;
  return !interview.time || minutesOf(interview.time) + INTERVIEW_UPCOMING_MINUTES > minutesOf(now.slice(11, 16));
}

/** A timed round today that has started but is still within its upcoming hour. */
export function isInterviewInProgress(interview: Pick<Schedulable, "date" | "time">, now: string) {
  return Boolean(interview.time) && interviewDateKey(interview.date) === now.slice(0, 10)
    && minutesOf(interview.time!) <= minutesOf(now.slice(11, 16)) && isUpcomingInterview(interview, now);
}

/** The next upcoming round, or else the most recent one. */
export function featuredInterview<T extends Schedulable>(interviews: T[], now: string) {
  const sorted = [...interviews].sort(compareInterviews);
  return sorted.find((interview) => isUpcomingInterview(interview, now)) ?? sorted.at(-1);
}

export function hasUpcomingInterview(application: Pick<ApplicationSummary, "interviews">, now: string) {
  return application.interviews.some((interview) => isUpcomingInterview(interview, now));
}

/** Formats a stored "HH:MM" time in the browser's locale. */
export function formatInterviewTime(time: string, timeFormat: TimeFormat = "system") {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC", ...hourCycleOption(timeFormat) }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

/** `firstDay` is the first day of the week, counted from Sunday (0); see `useWeekStartDay`. */
export function groupUpcomingInterviews(interviews: InterviewListItem[], now: string, firstDay = 1): InterviewGroup[] {
  const today = now.slice(0, 10);
  const tomorrow = addCalendarDays(today, 1);
  const weekStart = startOfCalendarWeek(today, firstDay);
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
    if (!isUpcomingInterview(interview, now)) continue;
    const date = interviewDateKey(interview.date);
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
export function getInterviewListItems(applications: ApplicationSummary[]): InterviewListItem[] {
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
export function getUpcomingInterviewCount(applications: ApplicationSummary[], now: string) {
  return applications.filter(isInProgressApplication).reduce((count, application) =>
    count + application.interviews.filter((interview) => isUpcomingInterview(interview, now)).length, 0);
}
