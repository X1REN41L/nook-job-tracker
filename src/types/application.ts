import type { InterviewType, Status } from "@prisma/client";

export type InterviewRecord = {
  id: string; applicationId: string; date: string; time: string | null; type: InterviewType;
  interviewers: string | null; notes: string | null; createdAt: string;
};

export type ContactRecord = {
  id: string; applicationId: string; name: string; role: string | null; email: string | null;
  linkedinUrl: string | null; notes: string | null; createdAt: string;
};

/** What every page loads for each application. The details panel loads the full record for one application. */
export type ApplicationSummary = {
  id: string; company: string; role: string; status: Status; archived: boolean; revision: number;
  source: string | null; appliedDate: string; interviewDatePromptDismissed: boolean; followUpDate: string | null; followUpNote: string | null;
  jobUrl: string | null; interviews: InterviewRecord[]; lastUpdated: string; createdAt: string;
};

/** An application as API responses return it. */
export type ApplicationRecord = ApplicationSummary & { notes: string | null; contacts: ContactRecord[] };

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
