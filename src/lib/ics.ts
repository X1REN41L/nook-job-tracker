import type { InterviewType } from "@prisma/client";

import { INTERVIEW_TYPE_LABELS } from "@/lib/interviews";

export type CalendarInterview = {
  id: string;
  date: string;
  time: string | null;
  type: InterviewType;
  interviewers: string | null;
  notes: string | null;
  role: string;
  company: string;
};

const EVENT_MINUTES = 60;

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Content lines are folded at 75 octets (RFC 5545 section 3.1), never inside a UTF-8 character.
function foldLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: Date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function compactDateTime(date: Date) {
  return `${compactDate(date)}T${[date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].map((part) => String(part).padStart(2, "0")).join("")}`;
}

function eventLines(interview: CalendarInterview, stamp: string) {
  const [year, month, day] = interview.date.slice(0, 10).split("-").map(Number);
  const [hours, minutes] = interview.time?.split(":").map(Number) ?? [0, 0];
  // Calendar arithmetic runs in UTC so no timezone shifts the date; timed events are then written as
  // floating local times, which calendars show at that clock time wherever the user is.
  const start = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  const timing = interview.time
    ? [`DTSTART:${compactDateTime(start)}`, `DTEND:${compactDateTime(new Date(start.getTime() + EVENT_MINUTES * 60_000))}`]
    : [`DTSTART;VALUE=DATE:${compactDate(start)}`, `DTEND;VALUE=DATE:${compactDate(new Date(start.getTime() + 86_400_000))}`];
  const description = [interview.interviewers && `With: ${interview.interviewers}`, interview.notes].filter(Boolean).join("\n\n");
  return [
    "BEGIN:VEVENT",
    `UID:${interview.id}@nook.local`,
    `DTSTAMP:${stamp}`,
    ...timing,
    `SUMMARY:${escapeText(`${INTERVIEW_TYPE_LABELS[interview.type]} interview: ${interview.role} at ${interview.company}`)}`,
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    "END:VEVENT",
  ];
}

/** An iCalendar (.ics) file with one event per interview round. */
export function interviewCalendar(interviews: CalendarInterview[], now = new Date()) {
  const stamp = `${compactDateTime(now)}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nook//Job Tracker//EN",
    "CALSCALE:GREGORIAN",
    ...interviews.flatMap((interview) => eventLines(interview, stamp)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function downloadCalendar(fileName: string, interviews: CalendarInterview[]) {
  const url = URL.createObjectURL(new Blob([interviewCalendar(interviews)], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
