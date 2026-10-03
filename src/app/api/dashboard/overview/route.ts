import { NextResponse } from "next/server";
import { apiError, validationErrorResponse } from "@/lib/api";
import { dashboardOverviewQuerySchema } from "@/lib/calendar-date";
import { getDashboardOverview } from "@/lib/dashboard-analytics";

export async function GET(request: Request) {
  try {
    const query = dashboardOverviewQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!query.success) return validationErrorResponse(query.error, "A valid user calendar date, time and timezone are required");
    return NextResponse.json(await getDashboardOverview(`${query.data.today}T${query.data.time}`, query.data.timeZone, query.data.staleApplicationThreshold, query.data.offset));
  } catch (error) {
    return apiError(error, "dashboard/overview");
  }
}
