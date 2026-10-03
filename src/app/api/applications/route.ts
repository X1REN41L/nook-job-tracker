import { NextResponse } from "next/server";

import { apiError, parseRequest } from "@/lib/api";
import { applicationInputSchema } from "@/lib/application-schema";
import { applicationInclude } from "@/lib/application-record";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";
import { statusTransitionDetail } from "@/lib/status-history";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const after = query.get("after") ?? "";
    const owner = query.get("owner");
    const collection = query.get("collection") ?? "interviews";
    if (owner) {
      const args = { where: { applicationId: owner, id: { gt: after } }, orderBy: { id: "asc" as const }, take: 200 };
      if (collection === "interviews") return NextResponse.json({ interviews: await prisma.interview.findMany(args) });
      if (collection === "contacts") return NextResponse.json({ contacts: await prisma.contact.findMany(args) });
      if (collection === "events") return NextResponse.json({ events: await prisma.applicationEvent.findMany(args) });
      return NextResponse.json({ error: "Unknown child collection" }, { status: 400 });
    }
    const page = { where: { id: { gt: after } }, orderBy: { id: "asc" as const }, take: 200 };
    if (query.get("paged") === "1") {
      const applications = await prisma.application.findMany({ ...page, omit: { notes: true }, include: { _count: { select: { interviews: true } } } });
      return NextResponse.json({ applications: applications.map(({ _count, ...record }) => ({ ...record, interviews: [], interviewCount: _count.interviews })) });
    }
    return NextResponse.json({ applications: await prisma.application.findMany({ ...page, include: applicationInclude }) });
  } catch (error) {
    return apiError(error, "applications");
  }
}

export async function POST(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const input = parseRequest(applicationInputSchema, parseMutationJson(checked.body));
    const application = await serializeWrite(() => prisma.application.create({
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
      include: applicationInclude,
    }));
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return apiError(error, "applications");
  }
}
