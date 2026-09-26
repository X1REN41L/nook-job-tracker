import { NextResponse } from "next/server";
import { apiError, validationErrorResponse } from "@/lib/api";
import { dashboardStaleQuerySchema } from "@/lib/calendar-date";
import { getStaleApplications } from "@/lib/dashboard-analytics";

export async function GET(request: Request) {
  try {
    const query = dashboardStaleQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!query.success) return validationErrorResponse(query.error, "A valid user calendar date and timezone are required");
    return NextResponse.json(await getStaleApplications(query.data.today, query.data.timeZone));
  } catch (error) {
    return apiError(error);
  }
}
