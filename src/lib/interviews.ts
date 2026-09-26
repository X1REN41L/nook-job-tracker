import { addCalendarDays, startOfCalendarWeek } from "@/lib/calendar-date";
import type { ApplicationRecord } from "@/types/application";

export type InterviewListItem = {
  id: string;
  date: string;
  role: string;
  company: string;
  note: string | null;
};

export type InterviewGroup = {
  key: string;
  label: string;
  interviews: InterviewListItem[];
};

export function interviewDateKey(value: string) {
  return value.slice(0, 10);
}

export function groupUpcomingInterviews(interviews: InterviewListItem[], today: string): InterviewGroup[] {
  const tomorrow = addCalendarDays(today, 1);
  const weekStart = startOfCalendarWeek(today);
  const thisWeekEnd = addCalendarDays(weekStart, 6);
  const nextWeekEnd = addCalendarDays(weekStart, 13);
  const groups: InterviewGroup[] = [
    { key: "today", label: "Today", interviews: [] },
    { key: "tomorrow", label: "Tomorrow", interviews: [] },
    { key: "later-this-week", label: "Later This Week", interviews: [] },
    { key: "next-week", label: "Next Week", interviews: [] },
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

  for (const group of groups) {
    group.interviews.sort((a, b) =>
      interviewDateKey(a.date).localeCompare(interviewDateKey(b.date)) || a.id.localeCompare(b.id)
    );
  }
  return groups.filter((group) => group.interviews.length > 0);
}

export function getInterviewListItems(applications: ApplicationRecord[]): InterviewListItem[] {
  return applications
    .filter((application) => application.interviewDate !== null)
    .map((application) => ({
      id: application.id,
      date: application.interviewDate!,
      role: application.role,
      company: application.company,
      note: application.notes,
    }));
}

export function getUpcomingInterviewCount(applications: ApplicationRecord[], today: string) {
  return applications.filter((application) =>
    application.interviewDate !== null &&
    interviewDateKey(application.interviewDate) >= today
  ).length;
}
