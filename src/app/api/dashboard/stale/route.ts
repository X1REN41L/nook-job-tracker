import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getStaleApplications } from "@/lib/dashboard-analytics";

export async function GET() {
  try {
    return NextResponse.json(await getStaleApplications());
  } catch (error) {
    return apiError(error);
  }
}
