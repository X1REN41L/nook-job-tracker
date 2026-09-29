import type { InterviewType, Status } from "@prisma/client";

export type InterviewRecord = {
  id: string; applicationId: string; date: string; time: string | null; type: InterviewType;
  interviewers: string | null; notes: string | null; createdAt: string;
};

export type ContactRecord = {
  id: string; applicationId: string; name: string; role: string | null; email: string | null;
  linkedinUrl: string | null; notes: string | null; createdAt: string;
};

export type ApplicationRecord = {
  id: string; company: string; role: string; status: Status; archived: boolean; revision: number;
  source: string | null; appliedDate: string; interviewDatePromptDismissed: boolean; followUpDate: string | null; followUpNote: string | null;
  notes: string | null; jobUrl: string | null; interviews: InterviewRecord[]; contacts: ContactRecord[];
  lastUpdated: string; createdAt: string;
};

export type JobFormState = {
  company: string;
  role: string;
  status: Status;
  source: string;
  appliedDate: string;
  notes: string;
  jobUrl: string;
};

/** The fields edited inline in the application view; status and follow-up have their own controls. */
export type ApplicationDetails = Omit<JobFormState, "status">;
