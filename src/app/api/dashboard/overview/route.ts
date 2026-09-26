import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, validationErrorResponse } from "@/lib/api";
import { calendarDateKeySchema } from "@/lib/calendar-date";
import { getDashboardOverview } from "@/lib/dashboard-analytics";

const overviewQuerySchema = z.object({ today: calendarDateKeySchema }).strict();

export async function GET(request: Request) {
  try {
    const query = overviewQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (!query.success) return validationErrorResponse(query.error, "A valid user calendar date is required");
    return NextResponse.json(await getDashboardOverview(query.data.today));
  } catch (error) {
    return apiError(error);
  }
}
