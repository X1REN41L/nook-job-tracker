import type { TimeFormat } from "@/lib/settings-values";

export function currentLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The local date and time to the minute, as "YYYY-MM-DDTHH:MM". */
export function currentLocalMinute() {
  const date = new Date();
  return `${currentLocalDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function currentBrowserTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone || /^[+-]\d/.test(timeZone)) return "UTC";
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    // UTC is the explicit fallback when the browser cannot supply a usable IANA timezone.
    return "UTC";
  }
}

// Calendar dates are stored at UTC midnight. The year is shown only outside the current local year.
export function formatCalendarDate(value: string, { currentYear = currentLocalDate().slice(0, 4), weekday = false }: { currentYear?: string; weekday?: boolean } = {}) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    ...(weekday && { weekday: "short" }), month: "short", day: "numeric", ...(value.slice(0, 4) !== currentYear && { year: "numeric" }), timeZone: "UTC",
  }).format(date);
}

function calendarDaysSince(value: string, today: string) {
  return Math.round((Date.parse(`${today.slice(0, 10)}T00:00:00.000Z`) - Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`)) / 86_400_000);
}

/** Compact age of a calendar date, such as "Today", "Yesterday", or "12d ago". Counts calendar days, not hours. */
export function formatDaysAgo(value: string, today: string) {
  const days = calendarDaysSince(value, today);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`;
}

/** A calendar-day count in words, such as "today", "yesterday", or "3 days ago". */
export function daysAgoPhrase(days: number) {
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** The Intl option for the chosen clock; "system" leaves it to the browser's locale. */
export function hourCycleOption(timeFormat: TimeFormat): Intl.DateTimeFormatOptions {
  return timeFormat === "12h" ? { hourCycle: "h12" } : timeFormat === "24h" ? { hourCycle: "h23" } : {};
}

// Timestamps (unlike calendar dates) are shown in the browser's own timezone.
export function formatTimestamp(value: string, timeFormat: TimeFormat = "system") {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", ...hourCycleOption(timeFormat) }).format(new Date(value));
}
