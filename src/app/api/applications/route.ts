import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { applicationInputSchema } from "@/lib/application-schema";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const applications = await prisma.application.findMany({
      orderBy: [{ appliedDate: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ applications });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = applicationInputSchema.parse(await request.json());
    const application = await prisma.application.create({
      data: input,
    });
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
