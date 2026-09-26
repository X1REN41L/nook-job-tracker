export type AnalyticsPeriod = "CURRENT_MONTH" | "LAST_3_MONTHS" | "CURRENT_YEAR" | "CUSTOM_MONTH" | "CUSTOM_YEAR";

export type AnalyticsSelection = {
  period: AnalyticsPeriod;
  month?: string;
  year?: number;
};

export type AnalyticsRange = { startDate: string; endDate: string };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function dateFromParts(year: number, monthIndex: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

export function monthStart(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function monthEnd(year: number, month: number) {
  return dateKey(dateFromParts(year, month, 0));
}

export function monthParts(key: string) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

export function shiftMonth(year: number, month: number, offset: number) {
  const date = dateFromParts(year, month - 1 + offset, 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function analyticsPeriodRange(selection: AnalyticsSelection, today?: string): AnalyticsRange {
  if (selection.period !== "CUSTOM_MONTH" && selection.period !== "CUSTOM_YEAR" && !today) {
    throw new Error("A user calendar date is required for current analytics periods");
  }
  const currentDate = today ?? "";
  const { year: currentYear, month: currentMonth } = monthParts(currentDate);
  switch (selection.period) {
    case "CURRENT_MONTH":
      return { startDate: monthStart(currentYear, currentMonth), endDate: currentDate };
    case "LAST_3_MONTHS": {
      const firstMonth = shiftMonth(currentYear, currentMonth, -2);
      return { startDate: monthStart(firstMonth.year, firstMonth.month), endDate: currentDate };
    }
    case "CURRENT_YEAR":
      return { startDate: `${String(currentYear).padStart(4, "0")}-01-01`, endDate: currentDate };
    case "CUSTOM_MONTH": {
      const { year, month } = monthParts(`${selection.month}-01`);
      return { startDate: monthStart(year, month), endDate: monthEnd(year, month) };
    }
    case "CUSTOM_YEAR":
      return {
        startDate: `${String(selection.year).padStart(4, "0")}-01-01`,
        endDate: `${String(selection.year).padStart(4, "0")}-12-31`,
      };
  }
}

export function analyticsCohortLabel({ startDate, endDate }: AnalyticsRange, period: AnalyticsPeriod, currentYear: string) {
  if (period === "CURRENT_YEAR" || period === "CUSTOM_YEAR") return startDate.slice(0, 4);

  const start = monthParts(startDate);
  if (period === "CUSTOM_MONTH" && startDate.slice(0, 4) !== currentYear) {
    return `${MONTH_NAMES[start.month - 1]} - ${startDate.slice(0, 4)}`;
  }
  const end = monthParts(endDate);
  const sameYear = start.year === end.year;
  const months: string[] = [];
  let cursor = start;
  while (cursor.year < end.year || (cursor.year === end.year && cursor.month <= end.month)) {
    const isFirst = cursor.year === start.year && cursor.month === start.month;
    const isLast = cursor.year === end.year && cursor.month === end.month;
    let label = MONTH_NAMES[cursor.month - 1];
    if (isFirst && !sameYear) label += ` ${cursor.year}`;
    if (isLast && endDate !== monthEnd(end.year, end.month)) label += ` 1-${Number(endDate.slice(8))}`;
    months.push(label);
    cursor = shiftMonth(cursor.year, cursor.month, 1);
  }
  return months.join(" + ");
}
