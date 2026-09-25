import type { ApplicationRecord } from "@/types/application";
import { Status } from "@prisma/client";

export type InterviewListItem = {
  id: string;
  date: string;
  role: string;
  company: string;
  note: string | null;
};

export function interviewDateKey(value: string) {
  return value.slice(0, 10);
}

export function getInterviewListItems(applications: ApplicationRecord[]): InterviewListItem[] {
  return applications
    .filter((application) =>
      !application.archived &&
      application.status === Status.INTERVIEW &&
      application.interviewDate !== null
    )
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
    !application.archived &&
    application.status === Status.INTERVIEW &&
    application.interviewDate !== null &&
    interviewDateKey(application.interviewDate) >= today
  ).length;
}
