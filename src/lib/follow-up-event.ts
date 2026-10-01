import { parseCalendarDateKey } from "@/lib/calendar-date";

// Matches the follow-up note limit in `application-schema.ts`.
const FOLLOW_UP_NOTE_MAX_LENGTH = 200;

/** A follow-up event's detail: the follow-up date ("YYYY-MM-DD"), then a space and the note when there is one. */
export function followUpEventDetail(date: string, note: string | null = null) {
  return note ? `${date} ${note}` : date;
}

/** Reads a follow-up event's detail; null when it is not in the form `followUpEventDetail` writes. */
export function parseFollowUpEventDetail(detail: string | null): { date: string; note: string | null } | null {
  if (!detail) return null;
  const date = detail.slice(0, 10);
  if (!parseCalendarDateKey(date)) return null;
  if (detail.length === 10) return { date, note: null };
  const note = detail.slice(11);
  if (detail[10] !== " " || !note || note.trim() !== note || note.length > FOLLOW_UP_NOTE_MAX_LENGTH) return null;
  return { date, note };
}
