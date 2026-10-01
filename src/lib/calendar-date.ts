import { z } from "zod";

export function parseCalendarDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function addCalendarDays(value: string, days: number) {
  const date = parseCalendarDateKey(value);
  if (!date) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + days);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** The first day of the week containing `value`; `firstDay` counts from Sunday (0) like `Date.getDay`, and defaults to Monday. */
export function startOfCalendarWeek(value: string, firstDay = 1) {
  const date = parseCalendarDateKey(value);
  if (!date) throw new Error("Invalid calendar date");
  return addCalendarDays(value, -((date.getUTCDay() - firstDay + 7) % 7));
}

export const calendarDateKeySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => parseCalendarDateKey(value) !== null, "Enter a valid calendar date");

export const timeZoneSchema = z.string().min(1).refine((value) => {
  try {
    // Intl validates IANA identifiers against the runtime's timezone database.
    // Numeric offsets are not accepted as a substitute for a timezone.
    return !/^[+-]\d/.test(value) && Boolean(new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}, "Enter a valid IANA timezone");

export const dashboardStaleQuerySchema = z.object({
  today: calendarDateKeySchema,
  timeZone: timeZoneSchema,
  staleApplicationThreshold: z.enum(["7", "15", "30"]).default("15").transform(Number),
}).strict();

// The user's local wall-clock time, so interviews earlier today can drop out of Upcoming.
export const dashboardOverviewQuerySchema = dashboardStaleQuerySchema.extend({
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
});

export function calendarDateInTimeZone(timestamp: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
