import { NextResponse } from "next/server";

import { apiError, parseRequest } from "@/lib/api";
import { applicationInputSchema } from "@/lib/application-schema";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma } from "@/lib/prisma";
import { statusTransitionDetail } from "@/lib/status-history";

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
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const input = parseRequest(applicationInputSchema, parseMutationJson(checked.body));
    const application = await prisma.application.create({
      data: {
        ...input,
        events: {
          create: {
            type: "STATUS_CHANGE",
            fromStatus: null,
            toStatus: input.status,
            detail: statusTransitionDetail(null, input.status),
            createdAt: new Date(),
          },
        },
      },
    });
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
