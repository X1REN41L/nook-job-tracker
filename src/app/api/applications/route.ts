import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { applicationInputSchema } from "@/lib/application-schema";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots } from "@/lib/undo-snapshots";

export async function GET() {
  try {
    await cleanupExpiredUndoSnapshots();
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
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const input = applicationInputSchema.parse(parseMutationJson(checked.body));
    const application = await prisma.application.create({
      data: input,
    });
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
