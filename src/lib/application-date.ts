export function currentLocalDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
export function formatCalendarDate(value: string, currentYear = currentLocalDate().slice(0, 4)) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", ...(value.slice(0, 4) !== currentYear && { year: "numeric" }), timeZone: "UTC",
  }).format(date);
}

export function calendarDaysSince(value: string, today: string) {
  return Math.round((Date.parse(`${today.slice(0, 10)}T00:00:00.000Z`) - Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`)) / 86_400_000);
}

/** Compact age of a calendar date, such as "Today" or "12d ago". */
export function formatDaysAgo(value: string, today: string) {
  const days = calendarDaysSince(value, today);
  return days <= 0 ? "Today" : `${days}d ago`;
}

// Timestamps (unlike calendar dates) are shown in the browser's own timezone.
export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
