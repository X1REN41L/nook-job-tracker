import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, validationErrorResponse } from "@/lib/api";
import { calendarDateKeySchema } from "@/lib/calendar-date";
import { getDashboardAnalytics } from "@/lib/dashboard-analytics";

const analyticsQuerySchema = z.object({
  period: z.enum(["CURRENT_MONTH", "LAST_3_MONTHS", "CURRENT_YEAR", "CUSTOM_MONTH", "CUSTOM_YEAR"]).default("CURRENT_MONTH"),
  month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM for a custom month").optional(),
  year: z.string().regex(/^[0-9]{4}$/, "Use YYYY for a custom year").optional(),
  today: calendarDateKeySchema.optional(),
}).strict().superRefine((query, context) => {
  if (["CURRENT_MONTH", "LAST_3_MONTHS", "CURRENT_YEAR"].includes(query.period) && !query.today) {
    context.addIssue({ code: "custom", path: ["today"], message: "A user calendar date is required for current periods" });
  }
  if (query.period === "CUSTOM_MONTH" && !query.month) {
    context.addIssue({ code: "custom", path: ["month"], message: "A month is required for CUSTOM_MONTH" });
  }
  if (query.period === "CUSTOM_YEAR" && !query.year) {
    context.addIssue({ code: "custom", path: ["year"], message: "A year is required for CUSTOM_YEAR" });
  }
  if (query.period !== "CUSTOM_MONTH" && query.month) {
    context.addIssue({ code: "custom", path: ["month"], message: "Month is only supported for CUSTOM_MONTH" });
  }
  if (query.period !== "CUSTOM_YEAR" && query.year) {
    context.addIssue({ code: "custom", path: ["year"], message: "Year is only supported for CUSTOM_YEAR" });
  }
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = analyticsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!query.success) return validationErrorResponse(query.error, "Invalid analytics period");
    const selection = {
      period: query.data.period,
      ...(query.data.month ? { month: query.data.month } : {}),
      ...(query.data.year ? { year: Number(query.data.year) } : {}),
    };
    return NextResponse.json(await getDashboardAnalytics(selection, query.data.today));
  } catch (error) {
    return apiError(error);
  }
}
