import type { Status } from "@prisma/client";

export type ApplicationRecord = {
  id: string; company: string; role: string; status: Status; archived: boolean; revision: number;
  source: string | null; appliedDate: string; interviewDate: string | null; interviewDatePromptDismissed: boolean; notes: string | null; jobUrl: string | null;
  lastUpdated: string; createdAt: string;
};

export type JobFormState = {
  company: string;
  role: string;
  status: Status;
  source: string;
  appliedDate: string;
  interviewDate: string;
  notes: string;
  jobUrl: string;
};
